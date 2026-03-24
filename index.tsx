/**
 * @fileoverview Control real time music with a MIDI controller
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import { classMap } from 'lit/directives/class-map.js';

import { GoogleGenAI, type GenerateContentResponse, type LiveMusicSession, type LiveMusicServerMessage } from '@google/genai';

import { decode, decodeAudioData, encodeWAV } from './utils/audio'
import { throttle } from './utils/throttle'
import { AudioAnalyser } from './utils/AudioAnalyser';
import { MidiDispatcher } from './utils/MidiDispatcher';
import './components/WeightKnob'; 
import './components/PromptController';
import { PlayPauseButton } from './components/PlayPauseButton';
import { ToastMessage } from './components/ToastMessage';
import './components/InitialSetupScreen'; 
import type { KnobGroup, InitialKnobConfig } from './components/InitialSetupScreen'; 
import { WeightHistoryGraph } from './components/WeightHistoryGraph';

import type { Prompt, PlaybackState } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
if (!process.env.API_KEY) {
  console.warn("[Lyria Debug] API_KEY is not defined in process.env. Lyria calls may fail.");
} else {
  console.log("[Lyria Debug] API_KEY is defined.");
}
const DEFAULT_MODEL_NAME = 'lyria-realtime-exp';
const GEMINI_MODEL_NAME = 'gemini-2.5-flash';


const AVAILABLE_SAMPLE_RATES = [16000, 24000, 32000, 44100, 48000];
const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_NUM_CHANNELS = 2;
const DEFAULT_CLIENT_BUFFER_TIME = 2; // seconds
const TOTAL_KNOBS = 16; 

const HISTORY_DURATION_MS = 15000; // 15 seconds
const HISTORY_SAMPLE_INTERVAL_MS = 250; // Sample 4 times per second

/** The main application component. */
@customElement('prompt-dj-midi')
class PromptDjMidi extends LitElement {
  static override styles = css`
    :host {
      --mono-font: 'JetBrains Mono', 'Roboto Mono', monospace;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      box-sizing: border-box;
      position: relative;
      overflow-y: auto;
      background: #050505;
      color: #fff;
      font-family: 'Inter', sans-serif;
    }
    :host([data-setup-complete]) {
       padding-top: 100px;
       padding-bottom: 40px;
    }
    
    #knob-groups-container {
      display: flex;
      flex-direction: column;
      gap: 32px;
      width: 95%;
      max-width: 1000px;
      margin-top: 24px;
    }

    .knob-group {
      background-color: #111;
      border-radius: 24px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }

    .knob-group-title {
      color: #666;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 0;
      margin-bottom: 24px;
      text-align: center;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding-bottom: 12px;
    }

    .knobs-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 24px;
      justify-content: center;
    }
    
    prompt-controller {
      width: 100%;
    }

    weight-history-graph {
      width: 95%;
      max-width: 1000px;
      height: 200px;
      margin-top: 32px;
      background-color: #0a0a0a;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      overflow: hidden;
    }

    #top-controls {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      padding: 16px 24px;
      box-sizing: border-box;
      z-index: 100;
      background: rgba(5, 5, 5, 0.8);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    #buttons {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    button, .button-like {
      font-family: var(--mono-font);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      color: #fff;
      background: #1a1a1a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 8px 16px;
      transition: all 0.2s ease;
    }

    button:hover:not(:disabled) {
      background: #222;
      border-color: rgba(255, 255, 255, 0.2);
    }

    button.active {
      background: #fff;
      color: #000;
      border-color: #fff;
    }

    button.recording {
      background: #ff4444;
      color: #fff;
      border-color: #ff4444;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.7; }
      100% { opacity: 1; }
    }

    #connection-status {
      font-family: var(--mono-font);
      font-size: 0.65rem;
      color: #444;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    #dev-settings-panel, #music-config-panel, .presets-panel {
      backdrop-filter: blur(20px);
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      z-index: 110;
      display: flex;
      flex-direction: column;
      gap: 16px;
      animation: slideIn 0.3s ease-out;
      max-height: 70vh;
      overflow-y: auto;
      padding: 24px;
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .dev-setting-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .dev-setting-row label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #444;
    }

    .dev-setting-row input, .dev-setting-row select {
      background: #0a0a0a;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 10px;
      color: #fff;
      font-size: 0.85rem;
      font-family: var(--mono-font);
    }

    .dev-setting-row input[type="range"] {
      padding: 0;
      height: 4px;
      background: #222;
      border: none;
      border-radius: 2px;
      appearance: none;
      margin: 10px 0;
    }
    .dev-setting-row input[type="range"]::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid #000;
    }
    .dev-setting-row span {
      font-family: var(--mono-font);
      font-size: 0.75rem;
      color: #666;
      text-align: right;
    }

    .preset-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 12px;
      font-size: 0.85rem;
    }
  `;

  @state() private prompts: Map<string, Prompt> = new Map();
  @state() private displayKnobGroups: KnobGroup[] = [];

  private midiDispatcher: MidiDispatcher;
  private audioAnalyser!: AudioAnalyser; 

  @state() private playbackState: PlaybackState = 'stopped';
  @state() private setupComplete = false;
  @state() private serverSetupComplete = false;


  private session?: LiveMusicSession;
  private audioContext!: AudioContext | null; // Allow null
  private outputNode!: GainNode; 
  private nextStartTime = 0;

  @state() private showMidi = false;
  @state() private audioLevel = 0;
  @state() private midiInputIds: string[] = [];
  @state() private activeMidiInputId: string | null = null;

  @property({ type: Object })
  private filteredPrompts = new Set<string>();

  private audioLevelRafId: number | null = null;
  private connectionError = true;

  @query('play-pause-button') private playPauseButton!: PlayPauseButton;
  @query('toast-message') private toastMessage!: ToastMessage;
  @query('weight-history-graph') private weightHistoryGraph!: WeightHistoryGraph;

  @state() private showDevSettings = false;
  @state() private devModelName = DEFAULT_MODEL_NAME;
  @state() private activeModelNameInSession: string = DEFAULT_MODEL_NAME;
  @state() private devClientBufferTime = DEFAULT_CLIENT_BUFFER_TIME;
  @state() private devAudioContextSampleRate = DEFAULT_SAMPLE_RATE;
  @state() private devNumDecodingChannels = DEFAULT_NUM_CHANNELS;
  @state() private connectionStatusMessage = 'Awaiting setup...';
  @state() private devSettingsHaveChanged = false;

  @state() private showMusicConfig = false;
  @state() private devGuidance = 4.0;
  @state() private devBpm = 120;
  @state() private devDensity = 0.5;
  @state() private devBrightness = 0.5;
  @state() private devScale = 'SCALE_UNSPECIFIED';
  @state() private devMuteBass = false;
  @state() private devMuteDrums = false;
  @state() private devOnlyBassAndDrums = false;
  @state() private devMusicGenerationMode = 'QUALITY';
  @state() private devTemperature = 1.1;
  @state() private devTopK = 40;
  @state() private devSeed = -1;
  @state() private musicConfigHaveChanged = false;
  private appliedBpm = 120;
  private appliedScale = 'SCALE_UNSPECIFIED';

  @state() private promptWeightHistory: Map<string, Array<{ time: number, weight: number }>> = new Map();
  private historyIntervalId: number | null = null;

  @state() private mixingStrategy: 'linear' | 'power' | 'softmax' = 'linear';
  @state() private mixingTemperature = 1.0;
  @state() private mixingPower = 2.0;

  @state() private showPresetsPanel = false;
  @state() private savedPresets: Array<{id?: number, name: string, knobGroups: KnobGroup[], mixing?: any}> = [];
  @query('#preset-name-input') private presetNameInput!: HTMLInputElement;

  @state() private isRecording = false;
  private recordedAudioChunks: AudioBuffer[] = [];


  constructor() {
    super();
    this.midiDispatcher = new MidiDispatcher();
    this.updateAudioLevel = this.updateAudioLevel.bind(this);
    this.samplePromptWeightsForHistory = this.samplePromptWeightsForHistory.bind(this);
    this.loadPresets();
  }

  private _updateDevSettingsChangedStatus() {
    const modelChanged = this.devModelName !== this.activeModelNameInSession;
    
    let sampleRateChanged = false;
    const isActiveContextValid = this.audioContext && this.audioContext.state !== 'closed';

    if (isActiveContextValid) {
      sampleRateChanged = this.devAudioContextSampleRate !== this.audioContext!.sampleRate;
    } else {
      // If no valid context, compare against the default rate user intends to set.
      sampleRateChanged = this.devAudioContextSampleRate !== DEFAULT_SAMPLE_RATE;
    }
    
    this.devSettingsHaveChanged = modelChanged || sampleRateChanged;
  }

  private initAudioSystem() {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(console.error);
    }
    this.audioContext = null; // Explicitly nullify before attempting to create new one

    const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;

    if (!AudioContextConstructor) {
      console.error('AudioContext is not supported in this browser.');
      this.toastMessage?.show?.('AudioContext not supported. Audio features will be disabled.');
      this.connectionStatusMessage = 'AudioContext not supported.';
      this.playbackState = 'stopped';
      this.connectionError = true;
      this._updateDevSettingsChangedStatus(); // Update status based on null context
      return;
    }

    try {
      console.log(`[Lyria Debug] Initializing AudioContext with sampleRate: ${this.devAudioContextSampleRate}`);
      this.audioContext = new AudioContextConstructor({ sampleRate: this.devAudioContextSampleRate });
      this.outputNode = this.audioContext.createGain();
      this.audioAnalyser = new AudioAnalyser(this.audioContext);
      console.log(`[Lyria Debug] AudioContext initialized. State: ${this.audioContext.state}`);
      
      // Connect output node directly to analyser
      this.outputNode.connect(this.audioAnalyser.node);
      this.audioAnalyser.node.connect(this.audioContext.destination);
      
      this.nextStartTime = 0;
      this.connectionError = false; 
    } catch (e: any) {
        console.error("Error initializing AudioContext:", e);
        this.toastMessage?.show?.(`Error initializing audio: ${e.message}`);
        this.connectionStatusMessage = `Audio initialization error: ${e.message}`;
        this.playbackState = 'stopped';
        this.connectionError = true;
        this.audioContext = null; // Ensure it's null on failure
    }
    this._updateDevSettingsChangedStatus();
  }

  override async firstUpdated() {
    this.updateAudioLevel();
    this._updateDevSettingsChangedStatus(); // Initial check
  }

  private handleKnobsGenerated(event: CustomEvent<KnobGroup[]>) {
    const generatedKnobGroups = event.detail;
    this.displayKnobGroups = generatedKnobGroups; // Store for rendering
    this.applyKnobConfiguration(generatedKnobGroups); // Process into flat this.prompts

    this.setupComplete = true;
    this.setAttribute('data-setup-complete', '');
    this.connectionStatusMessage = "Setup complete. Ready to connect. Press Play.";
    
    if (!this.audioContext || this.audioContext.state === 'closed') {
        this.initAudioSystem();
    }
    if (this.historyIntervalId) clearInterval(this.historyIntervalId);
    this.promptWeightHistory = new Map(); 
    this.historyIntervalId = window.setInterval(this.samplePromptWeightsForHistory, HISTORY_SAMPLE_INTERVAL_MS);
    this._updateDevSettingsChangedStatus();
  }

  private applyKnobConfiguration(knobGroupsToApply: KnobGroup[]) {
    const newPrompts = new Map<string, Prompt>();
    let ccCounter = 0;
    
    knobGroupsToApply.forEach(group => {
      group.knobs.forEach(knobConfig => {
        if (ccCounter < TOTAL_KNOBS) {
          const promptId = `prompt-${ccCounter}`;
          newPrompts.set(promptId, {
            promptId,
            text: knobConfig.text,
            color: knobConfig.color,
            weight: 0, // All weights initialized to 0
            cc: ccCounter,
            // groupName: group.groupName // Optionally store group name if needed later
          });
          ccCounter++;
        }
      });
    });

    // Ensure at least one prompt has a non-zero weight for Lyria initialization.
    let hasNonZeroWeight = false;
    for (const p of newPrompts.values()) {
        if (p.weight !== 0) {
            hasNonZeroWeight = true;
            break;
        }
    }

    if (!hasNonZeroWeight && newPrompts.size > 0) {
        // Find the first prompt (by cc=0) and set its weight to 1.0
        const firstPromptId = Array.from(newPrompts.keys())[0]; // Assuming map preserves insertion order for keys()
        if(firstPromptId) {
            const promptToModify = newPrompts.get(firstPromptId)!;
             promptToModify.weight = 1.0; 
            newPrompts.set(firstPromptId, promptToModify);
            console.log(`applyKnobConfiguration: Initialized weight of prompt "${promptToModify.text}" to 1.0 as all others were zero.`);
        }
    }

    this.prompts = newPrompts;
    this.promptWeightHistory = new Map(); // Reset history for new config
    this.requestUpdate();
  }

  private samplePromptWeightsForHistory() {
    if (this.playbackState !== 'playing' && this.playbackState !== 'loading' && this.playbackState !== 'paused') {
        return; 
    }

    const now = Date.now();
    const newHistory = new Map(this.promptWeightHistory);

    for (const [promptId, promptDetails] of this.prompts) {
        let historyArray = newHistory.get(promptId) || [];
        historyArray.push({ time: now, weight: promptDetails.weight });
        historyArray = historyArray.filter(point => now - point.time <= HISTORY_DURATION_MS);
        newHistory.set(promptId, historyArray);
    }
    this.promptWeightHistory = newHistory;
  }


  private async connectToSession() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
        this.initAudioSystem(); 
         if (!this.audioContext || this.connectionError) { // Check audioContext again after init attempt
            this.toastMessage?.show?.("Cannot connect: Audio system failed to initialize.");
            this.connectionStatusMessage = "Cannot connect: Audio system error.";
            this.connectionError = true;
            this._updateDevSettingsChangedStatus();
            return;
        }
    }
    
    this.serverSetupComplete = false; 
    this.connectionStatusMessage = `Connecting to model: ${this.devModelName}...`;
    console.log(`[Lyria Debug] Connecting to model: ${this.devModelName}`);
    
    if (!ai.live || !ai.live.music) {
      console.error("[Lyria Debug] ai.live.music is not available in the SDK.");
      this.toastMessage?.show?.("Critical Error: Lyria API not available in SDK.");
      this.connectionStatusMessage = "Lyria API not available.";
      this.connectionError = true;
      this.playbackState = 'stopped';
      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
      return;
    }

    try {
      this.session = await ai.live.music.connect({
        model: this.devModelName,
        callbacks: {
          onmessage: async (e: LiveMusicServerMessage) => {
            console.log(`[Lyria Debug] Received message from server:`, e);
            if (e.setupComplete) {
              console.log(`[Lyria Debug] Server setup complete.`);
              this.connectionError = false;
              this.serverSetupComplete = true;
              this.activeModelNameInSession = this.devModelName; 
              this.connectionStatusMessage = "Session setup complete. Sending initial prompts...";
              this._updateDevSettingsChangedStatus();

              if (this.prompts.size === 0) {
                 console.error("connectToSession/onmessage: Server setup complete, but no prompts configured locally. This should not happen.");
                 this.toastMessage?.show?.("Critical Error: Prompts not ready after server connection.");
                 this.playbackState = 'stopped';
                 if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                 this.connectionError = true;
                 if (this.session) this.session.close();
                 return;
              }
              
              const config: any = {
                guidance: this.devGuidance,
                bpm: this.devBpm,
                density: this.devDensity,
                brightness: this.devBrightness,
                muteBass: this.devMuteBass,
                muteDrums: this.devMuteDrums,
                onlyBassAndDrums: this.devOnlyBassAndDrums,
                musicGenerationMode: this.devMusicGenerationMode,
                temperature: this.devTemperature,
                topK: this.devTopK,
              };

              if (this.devScale !== 'SCALE_UNSPECIFIED') {
                config.scale = this.devScale;
              }

              if (this.devSeed !== -1) {
                config.seed = this.devSeed;
              }

              console.log("[Lyria Debug] Sending initial music generation config:", config);
              await this.session.setMusicGenerationConfig({
                musicGenerationConfig: config
              });
              
              this.appliedBpm = this.devBpm;
              this.appliedScale = this.devScale;

              await this.setSessionPrompts(); 

              if (this.session && !this.connectionError && (this.playbackState === 'loading' || this.playbackState === 'playing')) {
                  try {
                      console.log(`[Lyria Debug] Sending PLAY command to server...`);
                      await this.session.play();
                      this.connectionStatusMessage = "Session active. Music generating...";
                  } catch (playError: any) {
                      console.error('[Lyria Debug] Failed to send PLAY command post-server-setup:', playError);
                      this.toastMessage?.show?.(`Error starting playback on server: ${playError.message}`);
                      this.playbackState = 'stopped';
                      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                      this.connectionStatusMessage = `Error starting server playback: ${playError.message}`;
                          this.connectionError = true;
                  }
              } else if (this.playbackState !== 'loading' && this.playbackState !== 'playing') {
                  this.connectionStatusMessage = "Server ready, but playback was not initiated or was stopped.";
              }
            }
            if (e.filteredPrompt) {
              this.filteredPrompts = new Set([...this.filteredPrompts, e.filteredPrompt.text])
              this.toastMessage?.show?.(`Prompt filtered: ${e.filteredPrompt.filteredReason}`);
            }
            if (e.serverContent?.audioChunks !== undefined) {
              if (this.playbackState === 'paused' || this.playbackState === 'stopped') return;
              if (!this.audioContext || this.audioContext.state === 'closed') {
                console.warn("[Lyria Debug] AudioContext not available or closed, skipping audio processing.");
                return;
              }
              try {
                const audioBuffer = await decodeAudioData(
                  decode(e.serverContent?.audioChunks[0].data),
                  this.audioContext,
                  this.devAudioContextSampleRate, 
                  this.devNumDecodingChannels,
                );

                if (this.isRecording) {
                  this.recordedAudioChunks.push(audioBuffer);
                }

                const source = this.audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.outputNode);
                if (this.nextStartTime === 0) { 
                  this.nextStartTime = this.audioContext.currentTime + this.devClientBufferTime;
                  setTimeout(() => {
                    if (this.playbackState === 'loading') {
                       this.playbackState = 'playing';
                       this.connectionStatusMessage = "Playback started.";
                    }
                  }, this.devClientBufferTime * 1000);
                }

                if (this.nextStartTime < this.audioContext.currentTime) { 
                  this.playbackState = 'loading';
                  this.connectionStatusMessage = "Re-buffering audio...";
                  this.nextStartTime = 0; 
                  return;
                }
                source.start(this.nextStartTime);
                this.nextStartTime += audioBuffer.duration;
              } catch (decodeError: any) {
                console.error("[Lyria Debug] Error decoding or processing audio chunks:", decodeError);
              }
            }
          },
          onerror: (errEvent: ErrorEvent) => {
            console.error('[Lyria Debug] LiveMusicSession error:', errEvent);
            this.connectionError = true;
            this.serverSetupComplete = false;
            this.playbackState = 'stopped';
            if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            this.toastMessage?.show?.('Connection error, please restart audio.');
            this.connectionStatusMessage = `Connection error: ${errEvent.message || 'Unknown error'}`;
            this._updateDevSettingsChangedStatus();
          },
          onclose: (closeEvent: CloseEvent) => {
            console.log('[Lyria Debug] LiveMusicSession closed:', closeEvent);
            this.connectionError = true; 
            this.serverSetupComplete = false;
            if (this.playbackState !== 'stopped') {
                this.playbackState = 'stopped';
                 if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            }
            this.connectionStatusMessage = 'Session closed. Press Play to reconnect.';
            this._updateDevSettingsChangedStatus();
          },
        },
      });

    } catch (error: any) {
      console.error('[Lyria Debug] Failed to connect to LiveMusicSession:', error);
      this.connectionError = true;
      this.serverSetupComplete = false;
      this.toastMessage?.show?.(`Connection failed: ${error.message}. Please try again.`);
      this.connectionStatusMessage = `Connection failed: ${error.message}`;
      this.playbackState = 'stopped';
      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
      this._updateDevSettingsChangedStatus();
    }
  }

  private setSessionPrompts = throttle(async () => {
    if (!this.session || this.connectionError) {
        console.warn("setSessionPrompts: No session or connection error.");
        return;
    }

    if (!this.serverSetupComplete && this.playbackState === 'loading') { 
        console.warn("setSessionPrompts: Called before server setup is complete during initial loading. Deferring.");
        return;
    }

    let promptsToSend = Array.from(this.prompts.values()).map(p => ({
      text: p.text,
      weight: p.weight,
    }));

    // Apply Mixing Strategy
    if (this.mixingStrategy === 'power') {
      const weights = promptsToSend.map(p => Math.pow(p.weight, this.mixingPower));
      const sum = weights.reduce((a, b) => a + b, 0);
      promptsToSend = promptsToSend.map((p, i) => ({
        text: p.text,
        weight: sum > 0 ? weights[i] / sum : 0
      }));
    } else if (this.mixingStrategy === 'softmax') {
      // Softmax normalization
      const exps = promptsToSend.map(p => Math.exp(p.weight / this.mixingTemperature));
      const sum = exps.reduce((a, b) => a + b, 0);
      promptsToSend = promptsToSend.map((p, i) => ({
        text: p.text,
        weight: sum > 0 ? exps[i] / sum : 0
      }));
    }

    if (promptsToSend.length === 0) {
      console.error("setSessionPrompts: promptsToSend array is empty. Aborting Lyria API call. this.prompts.size:", this.prompts.size);
      this.toastMessage?.show?.("Internal Error: Prompts are empty.");
      this.playbackState = 'stopped';
      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
      this.connectionStatusMessage = "Internal prompt error. Session stopped.";
      if (this.session) this.session.close();
      return;
    }
    
    try {
        console.log(`[Lyria Debug] Sending weighted prompts to server:`, promptsToSend);
        await this.session.setWeightedPrompts({ weightedPrompts: promptsToSend });
    } catch (e: any) {
        console.error("[Lyria Debug] Error setting session prompts:", e);
        this.toastMessage?.show?.(`Error sending prompts: ${e.message}. Connection may be unstable.`);
        if (!this.serverSetupComplete || this.playbackState === 'loading') { 
            this.connectionError = true; 
            this.serverSetupComplete = false;
            this.playbackState = 'stopped'; 
            if (this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            this.connectionStatusMessage = `Error sending initial prompts. Session stopped.`;
            if (this.session) this.session.close(); 
        }
    }
  }, 200);

  private async updateAudioLevel() {
    this.audioLevelRafId = requestAnimationFrame(this.updateAudioLevel);
    if (this.audioAnalyser && this.audioContext && this.audioContext.state === 'running') {
        this.audioLevel = this.audioAnalyser.getCurrentLevel();
    } else {
        this.audioLevel = 0;
    }
  }

  private onPromptChange(e: CustomEvent<Prompt>) {
    const { promptId, ...changedProperties } = e.detail;
    const existingPrompt = this.prompts.get(promptId);
    if (existingPrompt) {
      this.prompts.set(promptId, { ...existingPrompt, ...changedProperties });
      if (this.session && this.serverSetupComplete && (this.playbackState === 'playing' || this.playbackState === 'paused')) {
         this.setSessionPrompts(); 
      }
    }
  }

  private async play() {
    if (!this.setupComplete) {
        this.toastMessage?.show?.("Please complete the setup first.");
        return;
    }
    if (this.playbackState === 'playing') return; 

    if (!this.audioContext || this.audioContext.state === 'closed' || this.connectionError) {
        this.initAudioSystem(); 
        if (!this.audioContext || this.connectionError) { 
            this.toastMessage?.show?.("Audio system error. Cannot start playback.");
            this.playbackState = 'stopped';
            if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            return;
        }
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.playbackState = 'loading';
    if(this.playPauseButton) this.playPauseButton.playbackState = 'loading';

    if (!this.session || this.connectionError || !this.serverSetupComplete) {
        this.connectionStatusMessage = "Attempting to connect/reconnect...";
        await this.connectToSession(); 
        if (this.connectionError) { 
            this.playbackState = 'stopped'; 
            if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            return; 
        }
    } else { 
        try {
            this.connectionStatusMessage = "Resuming session...";
            console.log(`[Lyria Debug] Sending PLAY command (resume) to server...`);
            await this.session.play(); 
            if (this.audioContext) { // Ensure context is valid before using currentTime
                 this.nextStartTime = this.audioContext.currentTime + this.devClientBufferTime; 
            } else { // Fallback if context became invalid unexpectedly
                this.playbackState = 'stopped';
                if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                this.connectionStatusMessage = "Audio error before resuming. Stopped.";
                return;
            }
        } catch (e: any) {
            console.error("[Lyria Debug] Error sending PLAY command (resume):", e);
            this.toastMessage?.show?.(`Error resuming playback: ${e.message}`);
            this.playbackState = 'paused'; 
            if(this.playPauseButton) this.playPauseButton.playbackState = 'paused';
            this.connectionStatusMessage = "Failed to resume. Still paused.";
        }
    }
  }


  private async pause() {
    if (this.playbackState !== 'playing' && this.playbackState !== 'loading') return;
    
    const intendedState = 'paused';
    this.playbackState = intendedState;
    if(this.playPauseButton) this.playPauseButton.playbackState = intendedState;

    if (this.session && !this.connectionError && this.serverSetupComplete) {
        try {
            console.log(`[Lyria Debug] Sending PAUSE command to server...`);
            await this.session.pause();
            this.connectionStatusMessage = "Session paused on server.";
        } catch (e: any) {
            console.error("[Lyria Debug] Error sending PAUSE command:", e);
            this.toastMessage?.show?.(`Error pausing server: ${e.message}. Paused locally.`);
            this.connectionStatusMessage = "Session pause attempted (server error). Paused locally.";
        }
    } else {
        this.connectionStatusMessage = "Session paused (locally).";
    }
  }

  private async stop() {
    const previousPlaybackState = this.playbackState;
    this.playbackState = 'stopped';
    if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
    this.serverSetupComplete = false; 


    if (this.session && !this.connectionError) { 
        try {
            console.log(`[Lyria Debug] Sending STOP command to server...`);
            await this.session.stop();
        } catch (e: any) {
            console.error("[Lyria Debug] Error sending STOP command to Lyria session:", e);
        } finally {
            if (this.session?.close) { 
                 this.session.close();
            }
        }
    }
    this.session = undefined;
    
    // Re-initialize audio system regardless of previous session state,
    // as stop() might be called to apply new audio settings.
    this.initAudioSystem(); 

    this.nextStartTime = 0;
    this.recordedAudioChunks = []; 
    this.isRecording = false;

    if (this.historyIntervalId) {
      clearInterval(this.historyIntervalId);
      this.historyIntervalId = null;
    }

    if (previousPlaybackState !== 'stopped' && 
        this.connectionStatusMessage !== 'Session closed. Press Play to reconnect.' && 
        !this.connectionStatusMessage.startsWith('Audio initialization error') &&
        !this.connectionStatusMessage.startsWith('Connection failed')) {
            this.connectionStatusMessage = "Session stopped. Press Play to start.";
    }
    this._updateDevSettingsChangedStatus();
  }

  private togglePlayPause() {
    if (this.playbackState === 'playing' || this.playbackState === 'loading') {
      this.pause();
    } else {
      this.play();
    }
  }
  
  private toggleMidi() {
    this.showMidi = !this.showMidi;
  }

  private async updateMidiInputs() {
    this.midiInputIds = await this.midiDispatcher.getMidiAccess();
    if (this.midiInputIds.length > 0 && !this.activeMidiInputId) {
      this.activeMidiInputId = this.midiInputIds[0];
      this.midiDispatcher.activeMidiInputId = this.activeMidiInputId;
    }
  }

  private onMidiInputChange(e: Event) {
    this.activeMidiInputId = (e.target as HTMLSelectElement).value;
    this.midiDispatcher.activeMidiInputId = this.activeMidiInputId;
  }

  private toggleDevSettings() {
    this.showDevSettings = !this.showDevSettings;
    if (this.showDevSettings) {
      this.showMusicConfig = false;
      this.showPresetsPanel = false;
    }
  }

  private toggleMusicConfig() {
    this.showMusicConfig = !this.showMusicConfig;
    if (this.showMusicConfig) {
      this.showDevSettings = false;
      this.showPresetsPanel = false;
    }
  }

  private togglePresetsPanel() {
    this.showPresetsPanel = !this.showPresetsPanel;
    if (this.showPresetsPanel) {
      this.showDevSettings = false;
      this.showMusicConfig = false;
    }
  }

  private async applyDevSettings() {
    if (!this.devSettingsHaveChanged) {
        this.toastMessage?.show?.("No relevant developer settings have changed.");
        return;
    }

    this.toastMessage?.show?.("Applying developer settings. Session will restart...");
    await this.stop(); // Stops session, re-initializes audio context with new sample rate
    await this.play(); // Attempts to reconnect with the new devModelName
    
    // After attempting to play (which includes connect), update status.
    // this._updateDevSettingsChangedStatus() is called within stop() and connectToSession()
    // so the state should be up-to-date.
  }

  private async applyMusicConfig() {
    if (!this.session || this.connectionError) {
      this.toastMessage?.show?.("Cannot apply music config without an active session.");
      return;
    }

    try {
      const config: any = {
        guidance: this.devGuidance,
        bpm: this.devBpm,
        density: this.devDensity,
        brightness: this.devBrightness,
        muteBass: this.devMuteBass,
        muteDrums: this.devMuteDrums,
        onlyBassAndDrums: this.devOnlyBassAndDrums,
        musicGenerationMode: this.devMusicGenerationMode,
        temperature: this.devTemperature,
        topK: this.devTopK,
      };

      if (this.devScale !== 'SCALE_UNSPECIFIED') {
        config.scale = this.devScale;
      }

      if (this.devSeed !== -1) {
        config.seed = this.devSeed;
      }

      console.log("[Lyria Debug] Applying music generation config:", config);
      await this.session.setMusicGenerationConfig({
        musicGenerationConfig: config
      });

      if (this.devBpm !== this.appliedBpm || this.devScale !== this.appliedScale) {
        console.log("[Lyria Debug] Resetting context for new BPM or Scale...");
        await this.session.resetContext();
        this.appliedBpm = this.devBpm;
        this.appliedScale = this.devScale;
      }
      
      this.musicConfigHaveChanged = false;
      this.toastMessage?.show?.("Music configuration applied successfully.");
    } catch (e: any) {
      console.error("[Lyria Debug] Error applying music config:", e);
      this.toastMessage?.show?.(`Error applying music config: ${e.message}`);
    }
  }
  
  private async savePreset() {
    const name = this.presetNameInput.value.trim();
    if (!name) {
      this.toastMessage?.show?.("Please enter a name for the preset.");
      return;
    }

    // Save the structured displayKnobGroups
    const currentKnobGroupsToSave = JSON.parse(JSON.stringify(this.displayKnobGroups));

    try {
      const response = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          config: { 
            knobGroups: currentKnobGroupsToSave,
            mixing: {
              strategy: this.mixingStrategy,
              temperature: this.mixingTemperature,
              power: this.mixingPower
            }
          } 
        })
      });
      if (response.ok) {
        const newPreset = await response.json();
        this.savedPresets = [newPreset, ...this.savedPresets];
        this.toastMessage?.show?.(`Preset "${name}" saved to database.`);
        this.presetNameInput.value = ""; 
      }
    } catch (e) {
      console.error("Error saving preset:", e);
      this.toastMessage?.show?.("Failed to save preset to database.");
    }
  }

  private loadPreset(presetName: string) {
    const preset = this.savedPresets.find(p => p.name === presetName);
    if (preset) {
      const newKnobGroups = JSON.parse(JSON.stringify(preset.knobGroups));
      this.displayKnobGroups = newKnobGroups; // Update display structure
      this.applyKnobConfiguration(newKnobGroups); // Process into flat prompts
      
      // Load mixing settings if they exist in the preset
      if (preset.mixing) {
        this.mixingStrategy = preset.mixing.strategy || 'linear';
        this.mixingTemperature = preset.mixing.temperature || 1.0;
        this.mixingPower = preset.mixing.power || 2.0;
      }
      
      if (this.session && this.serverSetupComplete && (this.playbackState === 'playing' || this.playbackState === 'paused')) {
          this.setSessionPrompts();
      }
      this.toastMessage?.show?.(`Preset "${presetName}" loaded.`);
      this.showPresetsPanel = false; 
    }
  }

  private async deletePreset(id: number, presetName: string) {
    if (confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
      try {
        const response = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
        if (response.ok) {
          this.savedPresets = this.savedPresets.filter(p => p.id !== id);
          this.toastMessage?.show?.(`Preset "${presetName}" deleted.`);
        }
      } catch (e) {
        console.error("Error deleting preset:", e);
        this.toastMessage?.show?.("Failed to delete preset.");
      }
    }
  }

  private async loadPresets() {
    try {
      const response = await fetch('/api/presets');
      if (response.ok) {
        const data = await response.json();
        this.savedPresets = data.map((p: any) => ({
          id: p.id,
          name: p.name,
          knobGroups: p.config.knobGroups,
          mixing: p.config.mixing
        }));
      }
    } catch (e) {
      console.error("Error loading presets:", e);
      this.toastMessage?.show?.("Failed to load presets from database.");
    }
  }

  private toggleRecording() {
    this.isRecording = !this.isRecording;
    if (this.isRecording) {
      this.recordedAudioChunks = []; 
      this.toastMessage?.show?.("Recording started.");
    } else {
      this.toastMessage?.show?.("Recording stopped.");
      this.saveRecording();
    }
  }

  private async saveRecording() {
    if (this.recordedAudioChunks.length === 0) {
      this.toastMessage?.show?.("No audio recorded to save.");
      return;
    }

    if (!this.audioContext || this.audioContext.state === 'closed') {
        this.toastMessage?.show?.("Audio context not available. Cannot process recording.");
        return;
    }

    const numChannels = this.recordedAudioChunks[0].numberOfChannels;
    const sampleRate = this.recordedAudioChunks[0].sampleRate; 
    let totalLength = 0;
    for (const buffer of this.recordedAudioChunks) {
      totalLength += buffer.length;
    }

    const mergedBuffer = this.audioContext.createBuffer(numChannels, totalLength, sampleRate);

    let offset = 0;
    for (const chunk of this.recordedAudioChunks) {
      for (let i = 0; i < numChannels; i++) {
        mergedBuffer.copyToChannel(chunk.getChannelData(i), i, offset);
      }
      offset += chunk.length;
    }

    const wavBlob = encodeWAV(mergedBuffer);

    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `prompt-dj-recording-${timestamp}.wav`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    this.toastMessage?.show?.("Recording saved as WAV.");
  }
  
  private async regenerateBoard() {
    const confirmationMessage = "Are you sure you want to generate a new soundboard? " +
                                "Your current layout and any unsaved recordings will be lost (unless saved as a preset).";

    if (confirm(confirmationMessage)) {
      await this.stop();
  
      // Explicitly reset all other state related to the board for a clean slate.
      this.prompts = new Map();
      this.displayKnobGroups = [];
      this.promptWeightHistory = new Map();
      this.filteredPrompts = new Set<string>();
      
      // Hide UI panels for a cleaner setup screen experience
      this.showMidi = false;
      this.showDevSettings = false;
      this.showPresetsPanel = false;
      
      // Finally, trigger the view switch back to the setup screen.
      this.setupComplete = false;
      this.removeAttribute('data-setup-complete');
      this.connectionStatusMessage = 'Awaiting setup...';
    }
  }
  
  override render() {
    if (!this.setupComplete) {
      return html`<initial-setup-screen @knobs-generated=${this.handleKnobsGenerated}></initial-setup-screen>`;
    }
    
    // Helper to find Prompt details from this.prompts using cc as the link
    const getPromptByCC = (cc: number): Prompt | undefined => {
        for (const prompt of this.prompts.values()) {
            if (prompt.cc === cc) return prompt;
        }
        return undefined;
    };

    let ccCounter = 0; // To assign CCs sequentially while rendering grouped knobs

    return html`
      <div id="background"></div>
      <toast-message></toast-message>
      <div id="top-controls">
        <div id="buttons">
          <button @click=${this.togglePlayPause} class=${classMap({ active: this.playbackState === 'playing' || this.playbackState === 'loading' })}>
            ${this.playbackState === 'playing' || this.playbackState === 'loading' ? 'Pause' : 'Play'}
          </button>
          <button @click=${this.toggleMidi} class=${classMap({ active: this.showMidi })}>MIDI</button>
          <button @click=${this.toggleDevSettings} class=${classMap({ active: this.showDevSettings })}>Settings</button>
          <button @click=${this.toggleMusicConfig} class=${classMap({ active: this.showMusicConfig })}>Music Config</button>
          <button @click=${this.togglePresetsPanel} class=${classMap({ active: this.showPresetsPanel })}>Presets</button>
          <button @click=${this.toggleRecording} class=${classMap({ recording: this.isRecording })}>
            ${this.isRecording ? 'Stop' : 'Record'}
          </button>
        </div>
        
        <div id="connection-status" role="status" aria-live="polite">${this.connectionStatusMessage}</div>
      </div>

      ${this.showDevSettings ? html`
        <div id="dev-settings-panel">
          <div class="dev-setting-row">
            <label for="dev-model-name">Model Name:</label>
            <input type="text" id="dev-model-name" .value=${this.devModelName} 
                   @input=${(e: Event) => { this.devModelName = (e.target as HTMLInputElement).value; this._updateDevSettingsChangedStatus(); }}>
          </div>
          <div class="dev-setting-row">
            <label for="dev-buffer-time">Client Buffer Time (s):</label>
            <input type="number" id="dev-buffer-time" min="0.1" max="10" step="0.1" .value=${this.devClientBufferTime.toString()} 
                   @input=${(e: Event) => this.devClientBufferTime = parseFloat((e.target as HTMLInputElement).value)}>
          </div>
          <div class="dev-setting-row">
            <label for="dev-sample-rate">AudioContext Sample Rate:</label>
            <select id="dev-sample-rate"
                    @change=${(e: Event) => { this.devAudioContextSampleRate = parseInt((e.target as HTMLSelectElement).value); this._updateDevSettingsChangedStatus();}}>
                ${AVAILABLE_SAMPLE_RATES.map(rate => html`<option value="${rate}" ?selected=${rate === this.devAudioContextSampleRate}>${rate} Hz</option>`)}
            </select>
          </div>
          <div class="dev-setting-row">
            <label for="mixing-strategy">Mixing Strategy:</label>
            <select id="mixing-strategy" @change=${(e: Event) => { this.mixingStrategy = (e.target as HTMLSelectElement).value as any; this.setSessionPrompts(); }}>
              <option value="linear" ?selected=${this.mixingStrategy === 'linear'}>Linear (Default)</option>
              <option value="power" ?selected=${this.mixingStrategy === 'power'}>Power Scale</option>
              <option value="softmax" ?selected=${this.mixingStrategy === 'softmax'}>Softmax</option>
            </select>
          </div>
          ${this.mixingStrategy === 'power' ? html`
            <div class="dev-setting-row">
              <label for="mixing-power">Mixing Power (p):</label>
              <input type="range" id="mixing-power" min="0.1" max="5.0" step="0.1" .value=${this.mixingPower.toString()} 
                     @input=${(e: Event) => { this.mixingPower = parseFloat((e.target as HTMLInputElement).value); this.setSessionPrompts(); }}>
              <span>${this.mixingPower.toFixed(1)}</span>
            </div>
          ` : ''}
          ${this.mixingStrategy === 'softmax' ? html`
            <div class="dev-setting-row">
              <label for="mixing-temp">Temperature (τ):</label>
              <input type="range" id="mixing-temp" min="0.1" max="2.0" step="0.1" .value=${this.mixingTemperature.toString()} 
                     @input=${(e: Event) => { this.mixingTemperature = parseFloat((e.target as HTMLInputElement).value); this.setSessionPrompts(); }}>
              <span>${this.mixingTemperature.toFixed(1)}</span>
            </div>
          ` : ''}
          <button @click=${this.applyDevSettings} ?disabled=${!this.devSettingsHaveChanged}>Apply Changes</button>
        </div>
      ` : ''}

      ${this.showMusicConfig ? html`
        <div id="music-config-panel">
          <div class="dev-setting-row">
            <label for="dev-guidance">Guidance (0-6):</label>
            <input type="range" id="dev-guidance" min="0" max="6" step="0.1" .value=${this.devGuidance.toString()} 
                   @input=${(e: Event) => { this.devGuidance = parseFloat((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
            <span>${this.devGuidance.toFixed(1)}</span>
          </div>
          <div class="dev-setting-row">
            <label for="dev-bpm">BPM (60-200):</label>
            <input type="number" id="dev-bpm" min="60" max="200" step="1" .value=${this.devBpm.toString()} 
                   @input=${(e: Event) => { this.devBpm = parseInt((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
          </div>
          <div class="dev-setting-row">
            <label for="dev-density">Density (0-1):</label>
            <input type="range" id="dev-density" min="0" max="1" step="0.05" .value=${this.devDensity.toString()} 
                   @input=${(e: Event) => { this.devDensity = parseFloat((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
            <span>${this.devDensity.toFixed(2)}</span>
          </div>
          <div class="dev-setting-row">
            <label for="dev-brightness">Brightness (0-1):</label>
            <input type="range" id="dev-brightness" min="0" max="1" step="0.05" .value=${this.devBrightness.toString()} 
                   @input=${(e: Event) => { this.devBrightness = parseFloat((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
            <span>${this.devBrightness.toFixed(2)}</span>
          </div>
          <div class="dev-setting-row">
            <label for="dev-scale">Scale:</label>
            <select id="dev-scale" @change=${(e: Event) => { this.devScale = (e.target as HTMLSelectElement).value; this.musicConfigHaveChanged = true; }}>
              <option value="SCALE_UNSPECIFIED" ?selected=${this.devScale === 'SCALE_UNSPECIFIED'}>Unspecified</option>
              <option value="C_MAJOR_A_MINOR" ?selected=${this.devScale === 'C_MAJOR_A_MINOR'}>C Major / A Minor</option>
              <option value="D_FLAT_MAJOR_B_FLAT_MINOR" ?selected=${this.devScale === 'D_FLAT_MAJOR_B_FLAT_MINOR'}>Db Major / Bb Minor</option>
              <option value="D_MAJOR_B_MINOR" ?selected=${this.devScale === 'D_MAJOR_B_MINOR'}>D Major / B Minor</option>
              <option value="E_FLAT_MAJOR_C_MINOR" ?selected=${this.devScale === 'E_FLAT_MAJOR_C_MINOR'}>Eb Major / C Minor</option>
              <option value="E_MAJOR_D_FLAT_MINOR" ?selected=${this.devScale === 'E_MAJOR_D_FLAT_MINOR'}>E Major / Db Minor</option>
              <option value="F_MAJOR_D_MINOR" ?selected=${this.devScale === 'F_MAJOR_D_MINOR'}>F Major / D Minor</option>
              <option value="G_FLAT_MAJOR_E_FLAT_MINOR" ?selected=${this.devScale === 'G_FLAT_MAJOR_E_FLAT_MINOR'}>Gb Major / Eb Minor</option>
              <option value="G_MAJOR_E_MINOR" ?selected=${this.devScale === 'G_MAJOR_E_MINOR'}>G Major / E Minor</option>
              <option value="A_FLAT_MAJOR_F_MINOR" ?selected=${this.devScale === 'A_FLAT_MAJOR_F_MINOR'}>Ab Major / F Minor</option>
              <option value="A_MAJOR_G_FLAT_MINOR" ?selected=${this.devScale === 'A_MAJOR_G_FLAT_MINOR'}>A Major / Gb Minor</option>
              <option value="B_FLAT_MAJOR_G_MINOR" ?selected=${this.devScale === 'B_FLAT_MAJOR_G_MINOR'}>Bb Major / G Minor</option>
              <option value="B_MAJOR_A_FLAT_MINOR" ?selected=${this.devScale === 'B_MAJOR_A_FLAT_MINOR'}>B Major / Ab Minor</option>
            </select>
          </div>
          <div class="dev-setting-row" style="flex-direction: row; align-items: center;">
            <input type="checkbox" id="dev-mute-bass" .checked=${this.devMuteBass} 
                   @change=${(e: Event) => { this.devMuteBass = (e.target as HTMLInputElement).checked; this.musicConfigHaveChanged = true; }}>
            <label for="dev-mute-bass" style="margin-top: 0;">Mute Bass</label>
          </div>
          <div class="dev-setting-row" style="flex-direction: row; align-items: center;">
            <input type="checkbox" id="dev-mute-drums" .checked=${this.devMuteDrums} 
                   @change=${(e: Event) => { this.devMuteDrums = (e.target as HTMLInputElement).checked; this.musicConfigHaveChanged = true; }}>
            <label for="dev-mute-drums" style="margin-top: 0;">Mute Drums</label>
          </div>
          <div class="dev-setting-row" style="flex-direction: row; align-items: center;">
            <input type="checkbox" id="dev-only-bass-drums" .checked=${this.devOnlyBassAndDrums} 
                   @change=${(e: Event) => { this.devOnlyBassAndDrums = (e.target as HTMLInputElement).checked; this.musicConfigHaveChanged = true; }}>
            <label for="dev-only-bass-drums" style="margin-top: 0;">Only Bass & Drums</label>
          </div>
          <div class="dev-setting-row">
            <label for="dev-generation-mode">Generation Mode:</label>
            <select id="dev-generation-mode" @change=${(e: Event) => { this.devMusicGenerationMode = (e.target as HTMLSelectElement).value; this.musicConfigHaveChanged = true; }}>
              <option value="QUALITY" ?selected=${this.devMusicGenerationMode === 'QUALITY'}>Quality</option>
              <option value="DIVERSITY" ?selected=${this.devMusicGenerationMode === 'DIVERSITY'}>Diversity</option>
              <option value="VOCALIZATION" ?selected=${this.devMusicGenerationMode === 'VOCALIZATION'}>Vocalization</option>
            </select>
          </div>
          <div class="dev-setting-row">
            <label for="dev-temperature">Temperature (0-3):</label>
            <input type="range" id="dev-temperature" min="0" max="3" step="0.1" .value=${this.devTemperature.toString()} 
                   @input=${(e: Event) => { this.devTemperature = parseFloat((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
            <span>${this.devTemperature.toFixed(1)}</span>
          </div>
          <div class="dev-setting-row">
            <label for="dev-topk">Top K (1-1000):</label>
            <input type="number" id="dev-topk" min="1" max="1000" step="1" .value=${this.devTopK.toString()} 
                   @input=${(e: Event) => { this.devTopK = parseInt((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
          </div>
          <div class="dev-setting-row">
            <label for="dev-seed">Seed (-1 for random):</label>
            <input type="number" id="dev-seed" min="-1" step="1" .value=${this.devSeed.toString()} 
                   @input=${(e: Event) => { this.devSeed = parseInt((e.target as HTMLInputElement).value); this.musicConfigHaveChanged = true; }}>
          </div>
          <button @click=${this.applyMusicConfig} ?disabled=${!this.musicConfigHaveChanged}>Apply Music Config</button>
        </div>
      ` : ''}

      ${this.showPresetsPanel ? html`
        <div class="presets-panel">
          <h3>Presets</h3>
          <div class="dev-setting-row">
            <input type="text" id="preset-name-input" placeholder="Name...">
            <button @click=${this.savePreset}>Save</button>
          </div>
          ${this.savedPresets.length > 0 ? this.savedPresets.map(preset => html`
            <div class="preset-item">
              <span>${preset.name}</span>
              <div style="display: flex; gap: 4px;">
                <button @click=${() => this.loadPreset(preset.name)}>Load</button>
                <button @click=${() => this.deletePreset(preset.id!, preset.name)} style="color: #ff4444; border-color: #ff4444;">Del</button>
              </div>
            </div>
          `) : html`<p style="color: #444; font-size: 0.8rem;">No presets saved yet.</p>`}
        </div>
      ` : ''}

      <div id="knob-groups-container">
        ${this.displayKnobGroups.map(group => html`
          <section class="knob-group" aria-labelledby="${group.groupName.replace(/\s+/g, '-').toLowerCase()}-title">
            <h3 id="${group.groupName.replace(/\s+/g, '-').toLowerCase()}-title" class="knob-group-title">${group.groupName}</h3>
            <div class="knobs-container">
              ${group.knobs.map(knobConfig => {
                const promptDetails = getPromptByCC(ccCounter);
                ccCounter++;
                
                if (!promptDetails) return html``;
                return html`
                  <prompt-controller
                    .promptId=${promptDetails.promptId}
                    .text=${promptDetails.text} 
                    .weight=${promptDetails.weight}
                    .color=${promptDetails.color} 
                    .cc=${promptDetails.cc}
                    .audioLevel=${this.audioLevel}
                    .midiDispatcher=${this.midiDispatcher}
                    .showCC=${this.showMidi}
                    ?filtered=${this.filteredPrompts.has(promptDetails.text)}
                    @prompt-changed=${this.onPromptChange}
                  ></prompt-controller>
                `;
              })}
            </div>
          </section>
        `)}
      </div>

      <weight-history-graph 
          .prompts=${this.prompts} 
          .history=${this.promptWeightHistory}
          .historyDurationMs=${HISTORY_DURATION_MS}
          ?active=${this.playbackState === 'playing' || this.playbackState === 'loading' || this.playbackState === 'paused'}
          .playbackStateForOverlay=${this.playbackState}>
      </weight-history-graph>
      
      <play-pause-button
        .playbackState=${this.playbackState}
        @click=${this.togglePlayPause}
        aria-label=${this.playbackState === 'playing' || this.playbackState === 'loading' ? 'Pause' : 'Play' }
        aria-pressed=${this.playbackState === 'playing' || this.playbackState === 'loading'}
        role="button">
      </play-pause-button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'prompt-dj-midi': PromptDjMidi;
  }
}