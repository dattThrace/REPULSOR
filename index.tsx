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
      --accent: #ff4e00;
      --bg: #050505;
      --panel-bg: rgba(15, 15, 15, 0.95);
      
      height: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      position: relative;
      background: radial-gradient(circle at 50% 0%, #1a1a1a 0%, #050505 100%);
      color: #fff;
      font-family: 'Inter', sans-serif;
      overflow: hidden;
    }
    
    #app-header {
      position: absolute;
      top: max(16px, env(safe-area-inset-top));
      left: 16px;
      right: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      background: rgba(20, 20, 20, 0.6);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 100px;
      z-index: 100;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }

    #app-title {
      font-weight: 800;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #fff 0%, #a5a5a5 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    #connection-status {
      font-family: var(--mono-font);
      font-size: 0.65rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #444;
    }
    .status-dot.active {
      background: #00ff00;
      box-shadow: 0 0 8px #00ff00;
    }
    .status-dot.error {
      background: #ff4444;
      box-shadow: 0 0 8px #ff4444;
    }

    #main-stage {
      flex: 1;
      overflow-y: auto;
      padding: calc(max(16px, env(safe-area-inset-top)) + 80px) 16px 120px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    #knob-groups-container {
      display: flex;
      flex-direction: column;
      gap: 32px;
      width: 100%;
      max-width: 1000px;
    }

    .knob-group {
      background: rgba(20, 20, 20, 0.4);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 32px;
      padding: 32px 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      box-shadow: 0 20px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
    }

    .knob-group-title {
      color: #fff;
      font-size: 0.85rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      margin-top: 0;
      margin-bottom: 32px;
      text-align: center;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding-bottom: 16px;
      opacity: 0.9;
    }

    .knobs-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 24px;
      justify-content: center;
    }

    prompt-controller {
      width: 100%;
    }

    weight-history-graph {
      width: 100%;
      max-width: 1000px;
      height: 200px;
      margin-top: 32px;
      background-color: #0a0a0a;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      overflow: hidden;
    }

    #bottom-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      padding: 16px 24px;
      padding-bottom: max(16px, env(safe-area-inset-bottom));
      background: rgba(10, 10, 10, 0.6);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      z-index: 200;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-sizing: border-box;
    }

    .bottom-controls-group {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: #888;
      padding: 12px;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
    }
    .icon-btn.active {
      color: var(--accent);
      background: rgba(255, 78, 0, 0.15);
    }
    .icon-btn.recording {
      color: #ff4444;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.5; }
      100% { opacity: 1; }
    }

    .play-pause-container {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(max(16px, env(safe-area-inset-bottom)) + 15px);
      z-index: 250;
    }
    
    play-pause-button {
      transform: scale(0.85);
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }

    .modal-content {
      background: rgba(20, 20, 20, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 32px;
      width: 100%;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }

    .modal-content p {
      margin: 0 0 24px 0;
      font-size: 1.05rem;
      line-height: 1.5;
      color: #fff;
    }

    .modal-actions {
      display: flex;
      gap: 16px;
      justify-content: center;
    }

    .modal-actions button {
      flex: 1;
    }

    .bottom-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      background: rgba(15, 15, 15, 0.85);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      border-radius: 32px 32px 0 0;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
      z-index: 150;
      padding: 32px 24px;
      padding-bottom: calc(100px + env(safe-area-inset-bottom));
      box-sizing: border-box;
      max-height: 85vh;
      overflow-y: auto;
      transform: translateY(100%);
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    }
    .bottom-sheet.open {
      transform: translateY(0);
      pointer-events: auto;
    }

    .sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .sheet-title {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0;
    }
    .close-btn {
      background: rgba(255,255,255,0.1);
      border: none;
      color: #fff;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .dev-setting-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
    }
    .dev-setting-row label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #aaa;
    }
    .dev-setting-row input:not([type="range"]):not([type="checkbox"]), .dev-setting-row select {
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 12px 16px;
      color: #fff;
      font-size: 1rem;
      font-family: var(--mono-font);
    }
    .dev-setting-row input:focus, .dev-setting-row select:focus {
      outline: none;
      border-color: var(--accent);
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
      width: 20px;
      height: 20px;
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

    .primary-btn {
      background: #fff;
      color: #000;
      border: none;
      border-radius: 100px;
      padding: 16px 24px;
      font-size: 0.9rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      cursor: pointer;
      width: 100%;
      margin-top: 16px;
      transition: background 0.2s;
    }
    .primary-btn:hover:not(:disabled) {
      background: #ccc;
    }
    .primary-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .preset-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      font-size: 0.9rem;
      margin-bottom: 8px;
    }
    .preset-item button {
      background: rgba(255,255,255,0.1);
      border: none;
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.7rem;
      text-transform: uppercase;
      font-weight: 700;
      cursor: pointer;
    }
    .preset-item button.del-btn {
      background: rgba(255, 68, 68, 0.2);
      color: #ff4444;
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
  @state() private confirmDialog: { show: boolean, message: string, onConfirm: () => void, onCancel: () => void } = { show: false, message: '', onConfirm: () => {}, onCancel: () => {} };
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
    if (navigator.vibrate) navigator.vibrate(50);
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

  private showConfirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmDialog = {
        show: true,
        message,
        onConfirm: () => {
          this.confirmDialog = { ...this.confirmDialog, show: false };
          resolve(true);
        },
        onCancel: () => {
          this.confirmDialog = { ...this.confirmDialog, show: false };
          resolve(false);
        }
      };
    });
  }

  private async handleMenuToggle(targetMenu: 'devSettings' | 'musicConfig' | 'presets') {
    if (this.showDevSettings && targetMenu !== 'devSettings' && this.devSettingsHaveChanged) {
      const proceed = await this.showConfirm("You have unsaved Settings. Close without applying?");
      if (!proceed) return;
    }
    if (this.showMusicConfig && targetMenu !== 'musicConfig' && this.musicConfigHaveChanged) {
      const proceed = await this.showConfirm("You have unsaved Music Config. Close without applying?");
      if (!proceed) return;
    }

    if (targetMenu === 'devSettings') {
      if (this.showDevSettings && this.devSettingsHaveChanged) {
         const proceed = await this.showConfirm("You have unsaved Settings. Close without applying?");
         if (!proceed) return;
      }
      this.showDevSettings = !this.showDevSettings;
      if (this.showDevSettings) { this.showMusicConfig = false; this.showPresetsPanel = false; }
    } else if (targetMenu === 'musicConfig') {
      if (this.showMusicConfig && this.musicConfigHaveChanged) {
         const proceed = await this.showConfirm("You have unsaved Music Config. Close without applying?");
         if (!proceed) return;
      }
      this.showMusicConfig = !this.showMusicConfig;
      if (this.showMusicConfig) { this.showDevSettings = false; this.showPresetsPanel = false; }
    } else if (targetMenu === 'presets') {
      this.showPresetsPanel = !this.showPresetsPanel;
      if (this.showPresetsPanel) { this.showDevSettings = false; this.showMusicConfig = false; }
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
    const proceed = await this.showConfirm(`Are you sure you want to delete the preset "${presetName}"?`);
    if (proceed) {
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

    const proceed = await this.showConfirm(confirmationMessage);
    if (proceed) {
      await this.stop();
  
      // Explicitly reset all other state related to the board for a clean slate.
      this.prompts = new Map();
      this.displayKnobGroups = [];
      this.promptWeightHistory = new Map();
      this.filteredPrompts = new Set<string>();
      
      // Hide UI panels for a cleaner setup screen experience
      this.showMidi = false;
      this.showDevSettings = false;
      this.showMusicConfig = false;
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
      
      <header id="app-header">
        <div id="app-title">PROMPT DJ</div>
        <div id="connection-status" role="status" aria-live="polite">
          <div class="status-dot ${this.connectionError ? 'error' : (this.serverSetupComplete ? 'active' : '')}"></div>
          ${this.connectionStatusMessage}
        </div>
      </header>

      <main id="main-stage">
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
      </main>

      <nav id="bottom-bar">
        <div class="bottom-controls-group">
          <button @click=${() => this.handleMenuToggle('devSettings')} class="icon-btn ${classMap({ active: this.showDevSettings })}" aria-label="Settings">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <button @click=${() => this.handleMenuToggle('musicConfig')} class="icon-btn ${classMap({ active: this.showMusicConfig })}" aria-label="Music Config">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
          </button>
        </div>

        <div class="bottom-controls-group">
          <button @click=${() => this.handleMenuToggle('presets')} class="icon-btn ${classMap({ active: this.showPresetsPanel })}" aria-label="Presets">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          </button>
          <button @click=${this.toggleMidi} class="icon-btn ${classMap({ active: this.showMidi })}" aria-label="MIDI">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="2" x2="8" y2="22"></line><line x1="16" y1="2" x2="16" y2="22"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
          </button>
          <button @click=${this.toggleRecording} class="icon-btn ${classMap({ recording: this.isRecording })}" aria-label="Record">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
        </div>
      </nav>

      <div class="play-pause-container">
        <play-pause-button
          .playbackState=${this.playbackState}
          @click=${this.togglePlayPause}
          aria-label=${this.playbackState === 'playing' || this.playbackState === 'loading' ? 'Pause' : 'Play' }
          aria-pressed=${this.playbackState === 'playing' || this.playbackState === 'loading'}
          role="button">
        </play-pause-button>
      </div>

      <div class="bottom-sheet ${classMap({ open: this.showDevSettings })}">
        <div class="sheet-header">
          <h2 class="sheet-title">Settings</h2>
          <button class="close-btn" @click=${() => this.handleMenuToggle('devSettings')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
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
        <button class="primary-btn" @click=${this.applyDevSettings} ?disabled=${!this.devSettingsHaveChanged}>Apply Changes</button>
      </div>

      <div class="bottom-sheet ${classMap({ open: this.showMusicConfig })}">
        <div class="sheet-header">
          <h2 class="sheet-title">Music Config</h2>
          <button class="close-btn" @click=${() => this.handleMenuToggle('musicConfig')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
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
        <button class="primary-btn" @click=${this.applyMusicConfig} ?disabled=${!this.musicConfigHaveChanged}>Apply Music Config</button>
      </div>

      <div class="bottom-sheet ${classMap({ open: this.showPresetsPanel })}">
        <div class="sheet-header">
          <h2 class="sheet-title">Presets</h2>
          <button class="close-btn" @click=${() => this.handleMenuToggle('presets')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="dev-setting-row" style="flex-direction: row; gap: 12px; margin-bottom: 24px;">
          <input type="text" id="preset-name-input" placeholder="Name..." style="flex: 1;">
          <button class="primary-btn" style="width: auto; margin: 0; padding: 12px 24px;" @click=${this.savePreset}>Save</button>
        </div>
        ${this.savedPresets.length > 0 ? this.savedPresets.map(preset => html`
          <div class="preset-item">
            <span style="font-weight: 600;">${preset.name}</span>
            <div style="display: flex; gap: 8px;">
              <button @click=${() => this.loadPreset(preset.name)}>Load</button>
              <button class="del-btn" @click=${() => this.deletePreset(preset.id!, preset.name)}>Del</button>
            </div>
          </div>
        `) : html`<p style="color: #666; font-size: 0.9rem; text-align: center; margin-top: 32px;">No presets saved yet.</p>`}
      </div>

      ${this.confirmDialog.show ? html`
        <div class="modal-overlay">
          <div class="modal-content">
            <p>${this.confirmDialog.message}</p>
            <div class="modal-actions">
              <button class="cancel-btn" @click=${this.confirmDialog.onCancel}>Cancel</button>
              <button class="primary-btn" @click=${this.confirmDialog.onConfirm}>Confirm</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'prompt-dj-midi': PromptDjMidi;
  }
}