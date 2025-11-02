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
import { generateImpulseResponse } from './utils/effects.ts';

import type { Prompt, PlaybackState } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const DEFAULT_MODEL_NAME = 'lyria-realtime-exp';
const GEMINI_MODEL_NAME = 'gemini-2.5-flash';


const AVAILABLE_SAMPLE_RATES = [16000, 24000, 32000, 44100, 48000];
const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_NUM_CHANNELS = 2;
const DEFAULT_CLIENT_BUFFER_TIME = 2; // seconds
const TOTAL_KNOBS = 16; 

const HISTORY_DURATION_MS = 15000; // 15 seconds
const HISTORY_SAMPLE_INTERVAL_MS = 250; // Sample 4 times per second

type ImpulseResponseMap = Map<'cathedral' | 'small_room' | 'cave' | 'none', AudioBuffer | null>;

interface EffectParameters {
  reverb: { impulseResponse: 'cathedral' | 'small_room' | 'cave' | 'none' };
  delay: { enabled: boolean; time: number; feedback: number; };
  filter: { enabled: boolean; type: 'lowpass' | 'highpass' | 'bandpass'; frequency: number; q: number; };
}

/** The main application component. */
@customElement('prompt-dj-midi')
class PromptDjMidi extends LitElement {
  static override styles = css`
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-start; /* Align groups to top */
      align-items: center;
      box-sizing: border-box;
      position: relative;
      overflow-y: auto; /* Allow scrolling for groups */
    }
    :host([data-setup-complete]) {
       padding-top: 80px; /* Increased padding for top controls */
       padding-bottom: 20px; /* Padding at the bottom */
    }
    #background {
      will-change: background-image;
      position: absolute;
      height: 100%;
      width: 100%;
      z-index: -1;
      background: #111;
    }
    
    #knob-groups-container {
      display: flex;
      flex-direction: column;
      gap: 20px; /* Space between groups */
      width: 90vmin;
      max-width: 900px; /* Increased max-width */
      margin-top: 2vmin;
    }

    .knob-group {
      background-color: rgba(40, 40, 40, 0.7);
      border-radius: 8px;
      padding: 15px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .knob-group-title {
      color: #eee;
      font-size: 1.2em;
      margin-top: 0;
      margin-bottom: 15px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.2);
      padding-bottom: 8px;
    }

    .knobs-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 150px)); /* Uniform knob size */
      gap: 2vmin;
      justify-content: center; /* Center knobs if they don't fill the row */
    }
    
    prompt-controller {
      width: 100%; /* Will be constrained by the grid cell's max-width */
      height: 100%; 
      display: flex; 
      align-items: center;
      justify-content: center;
    }

    weight-history-graph {
      width: 90vmin;
      max-width: 880px; 
      height: 240px; /* Increased graph height */
      margin-top: 2vmin;
      background-color: rgba(30, 30, 30, 0.7);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    #effects-panel {
      width: 90vmin;
      max-width: 880px;
      margin-top: 2vmin;
      padding: 15px;
      background-color: rgba(40, 40, 40, 0.7);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #eee;
    }
    #effects-panel h2 {
      margin-top: 0;
      font-size: 1.2em;
      border-bottom: 1px solid rgba(255,255,255,0.2);
      padding-bottom: 8px;
      margin-bottom: 15px;
    }
    .effects-controls {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .effects-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    #effects-prompt {
      flex-grow: 1;
      background: #222;
      color: #fff;
      border: 1px solid #555;
      border-radius: 4px;
      padding: 8px;
      resize: vertical;
      min-height: 40px;
      font-family: inherit;
    }
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 50px;
      height: 28px;
    }
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #555;
      transition: .4s;
      border-radius: 28px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: #4CAF50;
    }
    input:checked + .slider:before {
      transform: translateX(22px);
    }

    play-pause-button {
      position: relative;
      width: 15vmin;
      margin-top: 2vmin;
      margin-bottom: 2vmin; 
    }
    #top-controls {
      position: fixed; /* Changed to fixed for better visibility on scroll */
      top: 0;
      left: 0;
      width: 100%;
      padding: 10px 15px; /* Increased padding */
      box-sizing: border-box;
      z-index: 100; /* Ensure it's above other content */
      background: rgba(25, 25, 25, 0.9); /* Darker, more opaque background */
      backdrop-filter: blur(8px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    #buttons {
      display: flex;
      gap: 8px; /* Increased gap */
      align-items: center;
      flex-wrap: wrap;
    }
    button, .button-like {
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      background: rgba(0,0,0,0.3); /* Slightly more visible background */
      -webkit-font-smoothing: antialiased;
      border: 1.5px solid #fff;
      border-radius: 4px;
      user-select: none;
      padding: 5px 10px; /* Increased padding */
      transition: background-color 0.2s, color 0.2s, opacity 0.2s;
      &.active {
        background-color: #fff;
        color: #000;
      }
      &.recording {
        background-color: #ff4747;
        color: #fff;
        border-color: #ff0000;
      }
      &:hover:not(:disabled) {
        background-color: rgba(255,255,255,0.2);
      }
      &.active:hover:not(:disabled) {
         background-color: #eee;
      }
      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background-color: rgba(128, 128, 128, 0.2);
        border-color: rgba(128,128,128,0.5);
      }
    }
    select, input[type="text"], input[type="number"], textarea {
      font: inherit;
      padding: 8px; /* Increased padding */
      background: #fff;
      color: #000;
      border-radius: 4px;
      border: 1px solid #ccc;
      outline: none;
      cursor: pointer;
    }
    input[type="number"] {
      width: 70px; /* Slightly wider */
    }
    #dev-settings-panel, .presets-panel {
      padding: 15px; /* Increased padding */
      margin-top: 10px; /* Increased margin */
      background: rgba(50, 50, 50, 0.9); /* Slightly more opaque */
      border-radius: 6px; /* Smoother radius */
      display: flex;
      flex-direction: column;
      gap: 10px; /* Increased gap */
      color: white;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .presets-panel {
      max-height: 300px;
      overflow-y: auto;
    }
    .dev-setting-row {
      display: flex;
      align-items: center;
      gap: 10px; /* Increased gap */
    }
    .dev-setting-row label {
      min-width: 180px;
      font-size: 0.9em;
    }
     .dev-setting-row small {
        font-size: 0.8em;
        color: #ccc;
     }
    #connection-status {
      font-size: 0.9em; /* Slightly larger */
      color: #bbb; /* Lighter color */
      margin-top: 8px; /* Increased margin */
      min-height: 1.2em;
      padding-left: 5px;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }
    .presets-panel h3 { margin-top: 0; margin-bottom: 10px; }
    .preset-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px; /* Increased padding */
      background: rgba(0,0,0,0.3); /* Slightly more visible */
      border-radius: 4px; /* Smoother radius */
    }
    .preset-item span { flex-grow: 1; }
    .preset-item button { margin-left: 8px; font-size: 0.8em; padding: 4px 8px;}
    .loading-spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
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

  // Effects Chain
  private effectsInputNode!: GainNode;
  private convolverNode!: ConvolverNode;
  private delayNode!: DelayNode;
  private feedbackNode!: GainNode;
  private filterNode!: BiquadFilterNode;
  private effectsBypassNode!: GainNode;
  private impulseResponses!: ImpulseResponseMap;
  @state() private isEffectsChainActive = false;
  @state() private isEffectsLoading = false;
  @state() private effectsPrompt = 'A subtle echo in a small, warm room.';


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


  @state() private promptWeightHistory: Map<string, Array<{ time: number, weight: number }>> = new Map();
  private historyIntervalId: number | null = null;

  @state() private showPresetsPanel = false;
  @state() private savedPresets: Array<{name: string, knobGroups: KnobGroup[]}> = [];
  @query('#preset-name-input') private presetNameInput!: HTMLInputElement;

  @state() private isRecording = false;
  private recordedAudioChunks: AudioBuffer[] = [];


  constructor() {
    super();
    this.midiDispatcher = new MidiDispatcher();
    this.updateAudioLevel = this.updateAudioLevel.bind(this);
    this.samplePromptWeightsForHistory = this.samplePromptWeightsForHistory.bind(this);
    this.loadPresetsFromLocalStorage();
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
      this.toastMessage?.show('AudioContext not supported. Audio features will be disabled.');
      this.connectionStatusMessage = 'AudioContext not supported.';
      this.playbackState = 'stopped';
      this.connectionError = true;
      this._updateDevSettingsChangedStatus(); // Update status based on null context
      return;
    }

    try {
      this.audioContext = new AudioContextConstructor({ sampleRate: this.devAudioContextSampleRate });
      this.outputNode = this.audioContext.createGain();
      this.audioAnalyser = new AudioAnalyser(this.audioContext);
      
      // --- Setup Effects Chain ---
      this.effectsInputNode = this.audioContext.createGain();
      this.convolverNode = this.audioContext.createConvolver();
      this.delayNode = this.audioContext.createDelay(2.0); // Max 2s delay
      this.feedbackNode = this.audioContext.createGain();
      this.filterNode = this.audioContext.createBiquadFilter();
      this.effectsBypassNode = this.audioContext.createGain();

      // Create connections
      // WET Path: input -> filter -> delay -> convolver -> bypass
      this.effectsInputNode.connect(this.filterNode);
      this.filterNode.connect(this.delayNode);
      this.delayNode.connect(this.feedbackNode);
      this.feedbackNode.connect(this.delayNode); // Feedback loop
      this.delayNode.connect(this.convolverNode);
      this.convolverNode.connect(this.effectsBypassNode);

      // Main connection point: bypass node -> analyser -> destination
      this.effectsBypassNode.connect(this.audioAnalyser.node);
      this.audioAnalyser.node.connect(this.audioContext.destination);

      // Pre-generate and cache impulse responses
      this.impulseResponses = new Map();
      this.impulseResponses.set('cathedral', generateImpulseResponse('cathedral', this.audioContext));
      this.impulseResponses.set('small_room', generateImpulseResponse('small_room', this.audioContext));
      this.impulseResponses.set('cave', generateImpulseResponse('cave', this.audioContext));
      this.impulseResponses.set('none', generateImpulseResponse('none', this.audioContext));

      // Set initial state of effects chain (bypassed)
      this.toggleEffectsChain(this.isEffectsChainActive);
      
      this.nextStartTime = 0;
      this.connectionError = false; 
    } catch (e: any) {
        console.error("Error initializing AudioContext:", e);
        this.toastMessage?.show(`Error initializing audio: ${e.message}`);
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
    this.weightHistoryGraph?.setActive(this.playbackState === 'playing' || this.playbackState === 'loading', this.playbackState);
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
            this.toastMessage?.show("Cannot connect: Audio system failed to initialize.");
            this.connectionStatusMessage = "Cannot connect: Audio system error.";
            this.connectionError = true;
            this._updateDevSettingsChangedStatus();
            return;
        }
    }
    
    this.serverSetupComplete = false; 
    this.connectionStatusMessage = `Connecting to model: ${this.devModelName}...`;
    try {
      this.session = await ai.live.music.connect({
        model: this.devModelName,
        callbacks: {
          onmessage: async (e: LiveMusicServerMessage) => {
            if (e.setupComplete) {
              this.connectionError = false;
              this.serverSetupComplete = true;
              this.activeModelNameInSession = this.devModelName; 
              this.connectionStatusMessage = "Session setup complete. Sending initial prompts...";
              this._updateDevSettingsChangedStatus();

              if (this.prompts.size === 0) {
                 console.error("connectToSession/onmessage: Server setup complete, but no prompts configured locally. This should not happen.");
                 this.toastMessage?.show("Critical Error: Prompts not ready after server connection.");
                 this.playbackState = 'stopped';
                 if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                 this.weightHistoryGraph?.setActive(false, this.playbackState);
                 this.connectionError = true;
                 if (this.session) this.session.close();
                 return;
              }
              
              await this.setSessionPrompts(); 

              if (this.session && !this.connectionError && (this.playbackState === 'loading' || this.playbackState === 'playing')) {
                  try {
                      await this.session.play();
                      this.connectionStatusMessage = "Session active. Music generating...";
                  } catch (playError: any) {
                      console.error('Failed to send PLAY command post-server-setup:', playError);
                      this.toastMessage?.show(`Error starting playback on server: ${playError.message}`);
                      this.playbackState = 'stopped';
                      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                      this.connectionStatusMessage = `Error starting server playback: ${playError.message}`;
                      this.weightHistoryGraph?.setActive(false, this.playbackState);
                      this.connectionError = true;
                  }
              } else if (this.playbackState !== 'loading' && this.playbackState !== 'playing') {
                  this.connectionStatusMessage = "Server ready, but playback was not initiated or was stopped.";
              }
            }
            if (e.filteredPrompt) {
              this.filteredPrompts = new Set([...this.filteredPrompts, e.filteredPrompt.text])
              this.toastMessage?.show(`Prompt filtered: ${e.filteredPrompt.filteredReason}`);
            }
            if (e.serverContent?.audioChunks !== undefined) {
              if (this.playbackState === 'paused' || this.playbackState === 'stopped') return;
              if (!this.audioContext || this.audioContext.state === 'closed') {
                console.warn("AudioContext not available or closed, skipping audio processing.");
                return;
              }
              const audioBuffer = await decodeAudioData(
                decode(e.serverContent?.audioChunks[0].data),
                this.audioContext,
                this.devAudioContextSampleRate, // Use dev setting as it's the target for the current context
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
                  this.weightHistoryGraph?.setActive(this.playbackState === 'playing' || this.playbackState === 'loading', this.playbackState);
                }, this.devClientBufferTime * 1000);
              }

              if (this.nextStartTime < this.audioContext.currentTime) { 
                this.playbackState = 'loading';
                this.connectionStatusMessage = "Re-buffering audio...";
                this.nextStartTime = 0; 
                this.weightHistoryGraph?.setActive(true, this.playbackState);
                return;
              }
              source.start(this.nextStartTime);
              this.nextStartTime += audioBuffer.duration;
            }
          },
          onerror: (errEvent: ErrorEvent) => {
            console.error('LiveMusicSession error:', errEvent);
            this.connectionError = true;
            this.serverSetupComplete = false;
            this.playbackState = 'stopped';
            if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            this.toastMessage?.show('Connection error, please restart audio.');
            this.connectionStatusMessage = `Connection error: ${errEvent.message || 'Unknown error'}`;
            this.weightHistoryGraph?.setActive(false, this.playbackState);
            this._updateDevSettingsChangedStatus();
          },
          onclose: (closeEvent: CloseEvent) => {
            console.log('LiveMusicSession closed:', closeEvent);
            this.connectionError = true; 
            this.serverSetupComplete = false;
            if (this.playbackState !== 'stopped') {
                this.playbackState = 'stopped';
                 if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                this.weightHistoryGraph?.setActive(false, this.playbackState);
            }
            this.connectionStatusMessage = 'Session closed. Press Play to reconnect.';
            this._updateDevSettingsChangedStatus();
          },
        },
      });

    } catch (error: any) {
      console.error('Failed to connect to LiveMusicSession:', error);
      this.connectionError = true;
      this.serverSetupComplete = false;
      this.toastMessage?.show(`Connection failed: ${error.message}. Please try again.`);
      this.connectionStatusMessage = `Connection failed: ${error.message}`;
      this.playbackState = 'stopped';
      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
      this.weightHistoryGraph?.setActive(false, this.playbackState);
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

    const promptsToSend = Array.from(this.prompts.values()).map(p => ({
      text: p.text,
      weight: p.weight,
    }));

    if (promptsToSend.length === 0) {
      console.error("setSessionPrompts: promptsToSend array is empty. Aborting Lyria API call. this.prompts.size:", this.prompts.size);
      this.toastMessage?.show("Internal Error: Prompts are empty.");
      this.playbackState = 'stopped';
      if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
      this.connectionStatusMessage = "Internal prompt error. Session stopped.";
      this.weightHistoryGraph?.setActive(false, this.playbackState);
      if (this.session) this.session.close();
      return;
    }
    
    try {
        await this.session.setWeightedPrompts({ weightedPrompts: promptsToSend });
    } catch (e: any) {
        console.error("Error setting session prompts:", e);
        this.toastMessage?.show(`Error sending prompts: ${e.message}. Connection may be unstable.`);
        if (!this.serverSetupComplete || this.playbackState === 'loading') { 
            this.connectionError = true; 
            this.serverSetupComplete = false;
            this.playbackState = 'stopped'; 
            if (this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            this.connectionStatusMessage = `Error sending initial prompts. Session stopped.`;
            this.weightHistoryGraph?.setActive(false, this.playbackState);
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
        this.toastMessage?.show("Please complete the setup first.");
        return;
    }
    if (this.playbackState === 'playing') return; 

    if (!this.audioContext || this.audioContext.state === 'closed' || this.connectionError) {
        this.initAudioSystem(); 
        if (!this.audioContext || this.connectionError) { 
            this.toastMessage?.show("Audio system error. Cannot start playback.");
            this.playbackState = 'stopped';
            if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            this.weightHistoryGraph?.setActive(false, this.playbackState);
            return;
        }
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.playbackState = 'loading';
    this.weightHistoryGraph?.setActive(true, this.playbackState);
    if(this.playPauseButton) this.playPauseButton.playbackState = 'loading';

    if (!this.session || this.connectionError || !this.serverSetupComplete) {
        this.connectionStatusMessage = "Attempting to connect/reconnect...";
        await this.connectToSession(); 
        if (this.connectionError) { 
            this.playbackState = 'stopped'; 
            if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
            this.weightHistoryGraph?.setActive(false, this.playbackState);
            return; 
        }
    } else { 
        try {
            this.connectionStatusMessage = "Resuming session...";
            await this.session.play(); 
            if (this.audioContext) { // Ensure context is valid before using currentTime
                 this.nextStartTime = this.audioContext.currentTime + this.devClientBufferTime; 
            } else { // Fallback if context became invalid unexpectedly
                this.playbackState = 'stopped';
                if(this.playPauseButton) this.playPauseButton.playbackState = 'stopped';
                this.connectionStatusMessage = "Audio error before resuming. Stopped.";
                this.weightHistoryGraph?.setActive(false, this.playbackState);
                return;
            }
        } catch (e: any) {
            console.error("Error sending PLAY command (resume):", e);
            this.toastMessage?.show(`Error resuming playback: ${e.message}`);
            this.playbackState = 'paused'; 
            if(this.playPauseButton) this.playPauseButton.playbackState = 'paused';
            this.connectionStatusMessage = "Failed to resume. Still paused.";
            this.weightHistoryGraph?.setActive(true, this.playbackState); 
        }
    }
  }


  private async pause() {
    if (this.playbackState !== 'playing' && this.playbackState !== 'loading') return;
    
    const intendedState = 'paused';
    this.playbackState = intendedState;
    if(this.playPauseButton) this.playPauseButton.playbackState = intendedState;
    this.weightHistoryGraph?.setActive(true, this.playbackState); 

    if (this.session && !this.connectionError && this.serverSetupComplete) {
        try {
            await this.session.pause();
            this.connectionStatusMessage = "Session paused on server.";
        } catch (e: any) {
            console.error("Error sending PAUSE command:", e);
            this.toastMessage?.show(`Error pausing server: ${e.message}. Paused locally.`);
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
            await this.session.stop();
        } catch (e: any) {
            console.error("Error sending STOP command to Lyria session:", e);
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
    this.weightHistoryGraph?.setActive(false, this.playbackState);

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
  }

 private async applyDevSettings() {
    if (!this.devSettingsHaveChanged) {
        this.toastMessage?.show("No relevant developer settings have changed.");
        return;
    }

    this.toastMessage?.show("Applying developer settings. Session will restart...");
    await this.stop(); // Stops session, re-initializes audio context with new sample rate
    await this.play(); // Attempts to reconnect with the new devModelName
    
    // After attempting to play (which includes connect), update status.
    // this._updateDevSettingsChangedStatus() is called within stop() and connectToSession()
    // so the state should be up-to-date.
  }
  
  private savePreset() {
    const name = this.presetNameInput.value.trim();
    if (!name) {
      this.toastMessage?.show("Please enter a name for the preset.");
      return;
    }
    if (this.savedPresets.find(p => p.name === name)) {
      if (!confirm(`A preset named "${name}" already exists. Overwrite it?`)) {
        return;
      }
      this.savedPresets = this.savedPresets.filter(p => p.name !== name);
    }

    // Save the structured displayKnobGroups
    const currentKnobGroupsToSave = JSON.parse(JSON.stringify(this.displayKnobGroups));

    this.savedPresets.push({ name, knobGroups: currentKnobGroupsToSave });
    this.savePresetsToLocalStorage();
    this.toastMessage?.show(`Preset "${name}" saved.`);
    this.presetNameInput.value = ""; 
  }

  private loadPreset(presetName: string) {
    const preset = this.savedPresets.find(p => p.name === presetName);
    if (preset) {
      const newKnobGroups = JSON.parse(JSON.stringify(preset.knobGroups));
      this.displayKnobGroups = newKnobGroups; // Update display structure
      this.applyKnobConfiguration(newKnobGroups); // Process into flat prompts
      
      if (this.session && this.serverSetupComplete && (this.playbackState === 'playing' || this.playbackState === 'paused')) {
          this.setSessionPrompts();
      }
      this.toastMessage?.show(`Preset "${presetName}" loaded.`);
      this.showPresetsPanel = false; 
    }
  }

  private deletePreset(presetName: string) {
    if (confirm(`Are you sure you want to delete the preset "${presetName}"?`)) {
      this.savedPresets = this.savedPresets.filter(p => p.name !== presetName);
      this.savePresetsToLocalStorage();
      this.toastMessage?.show(`Preset "${presetName}" deleted.`);
    }
  }

  private savePresetsToLocalStorage() {
    try {
      localStorage.setItem('promptDjPresets', JSON.stringify(this.savedPresets));
    } catch (e) {
      console.error("Error saving presets to LocalStorage:", e);
      this.toastMessage?.show("Could not save presets to local storage.");
    }
  }

  private loadPresetsFromLocalStorage() {
    try {
      const storedPresets = localStorage.getItem('promptDjPresets');
      if (storedPresets) {
        this.savedPresets = JSON.parse(storedPresets);
      }
    } catch (e) {
      console.error("Error loading presets from LocalStorage:", e);
      this.savedPresets = []; 
    }
  }

  private togglePresetsPanel() {
    this.showPresetsPanel = !this.showPresetsPanel;
  }
  
  private toggleRecording() {
    this.isRecording = !this.isRecording;
    if (this.isRecording) {
      this.recordedAudioChunks = []; 
      this.toastMessage?.show("Recording started.");
    } else {
      this.toastMessage?.show("Recording stopped.");
      this.saveRecording();
    }
  }

  private async saveRecording() {
    if (this.recordedAudioChunks.length === 0) {
      this.toastMessage?.show("No audio recorded to save.");
      return;
    }

    if (!this.audioContext || this.audioContext.state === 'closed') {
        this.toastMessage?.show("Audio context not available. Cannot process recording.");
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
    this.toastMessage?.show("Recording saved as WAV.");
  }
  
  private async regenerateBoard() {
    const confirmationMessage = "Are you sure you want to generate a new soundboard? " +
                                "Your current layout and any unsaved recordings will be lost (unless saved as a preset).";

    if (confirm(confirmationMessage)) {
      // Set flags that affect stop() or initAudioSystem() *before* calling it.
      // This ensures the new audio system is initialized in a clean, bypassed state.
      this.isEffectsChainActive = false;

      await this.stop();
  
      // Explicitly reset all other state related to the board for a clean slate.
      this.prompts = new Map();
      this.displayKnobGroups = [];
      this.promptWeightHistory = new Map();
      this.filteredPrompts = new Set<string>();
      
      // Reset effects UI state to default
      this.effectsPrompt = 'A subtle echo in a small, warm room.';
      this.isEffectsLoading = false;

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
  
  private toggleEffectsChain(forceState?: boolean) {
    this.isEffectsChainActive = forceState ?? !this.isEffectsChainActive;
    if (!this.audioContext || !this.outputNode || !this.effectsInputNode || !this.effectsBypassNode) return;

    // Disconnect outputNode from wherever it's currently connected
    this.outputNode.disconnect();
    
    if (this.isEffectsChainActive) {
        // Connect WET path
        this.outputNode.connect(this.effectsInputNode);
        this.toastMessage?.show("Master effects enabled.");
    } else {
        // Connect DRY path (bypass effects)
        this.outputNode.connect(this.effectsBypassNode);
        this.toastMessage?.show("Master effects bypassed.");
    }
  }
  
  private applyEffectParameters(params: EffectParameters) {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;

    // Reverb
    const irBuffer = this.impulseResponses.get(params.reverb.impulseResponse);
    this.convolverNode.buffer = irBuffer || null;
    
    // Delay
    this.delayNode.delayTime.setTargetAtTime(params.delay.enabled ? params.delay.time : 0, now, 0.01);
    this.feedbackNode.gain.setTargetAtTime(params.delay.enabled ? params.delay.feedback : 0, now, 0.01);

    // Filter
    if (params.filter.enabled) {
        this.filterNode.type = params.filter.type;
        this.filterNode.frequency.setTargetAtTime(params.filter.frequency, now, 0.01);
        this.filterNode.Q.setTargetAtTime(params.filter.q, now, 0.01);
    } else {
        // To disable the filter, we effectively turn it into a passthrough.
        this.filterNode.type = 'allpass';
        this.filterNode.frequency.setTargetAtTime(this.audioContext.sampleRate / 2, now, 0.01);
        this.filterNode.Q.setTargetAtTime(1, now, 0.01);
    }
  }
  
  private async applySmartEffects() {
    this.isEffectsLoading = true;
    const systemInstruction = `You are an expert audio engineer translating natural language into parameters for a Web Audio API effects chain. Your output MUST be a single, valid JSON object and nothing else. Do not wrap it in markdown.
The user will describe a sound environment or effect. You must translate this into settings for the following three effects modules: reverb, delay, and filter.
The JSON object must have three top-level keys: "reverb", "delay", and "filter".

1.  **Reverb Module (ConvolverNode):**
    - The "reverb" key's value is an object with one key: "impulseResponse".
    - The "impulseResponse" value MUST be one of the following strings, representing available impulse responses: "cathedral", "small_room", "cave", "none".
    - Choose the best fit for the user's prompt. Choose "none" if no reverb is implied.

2.  **Delay Module (DelayNode):**
    - The "delay" key's value is an object with three keys: "enabled", "time", "feedback".
    - "enabled": A boolean (true/false). Set to true if the prompt implies an echo or delay.
    - "time": A number between 0.0 and 2.0 (in seconds). This is the delay time. A longer time for distinct echoes, shorter for a 'slapback' effect.
    - "feedback": A number between 0.0 and 0.9. This is the amount of delayed signal fed back into the delay line, creating repeating echoes. 0.0 means one echo. 0.9 is almost infinite.

3.  **Filter Module (BiquadFilterNode):**
    - The "filter" key's value is an object with four keys: "enabled", "type", "frequency", "q".
    - "enabled": A boolean (true/false). Set to true if the prompt implies tonal shaping (e.g., "muffled", "tinny", "underwater", "warm").
    - "type": MUST be one of the following strings: "lowpass", "highpass", "bandpass".
    - "frequency": A number between 20 and 20000 (in Hz). This is the filter's cutoff or center frequency.
    - "q": A number between 0.1 and 20. This is the Quality or resonance factor. Keep it around 1 for most natural effects.
    
Your response MUST be ONLY the JSON object.
`;

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: GEMINI_MODEL_NAME,
            contents: this.effectsPrompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json",
            }
        });
        
        let jsonStr = response.text.trim();
        const fenceRegex = /^```(?:json)?\s*\n?(.*?)\n?\s*```$/s;
        const match = jsonStr.match(fenceRegex);
        if (match && match[1]) {
            jsonStr = match[1].trim();
        }

        const params: EffectParameters = JSON.parse(jsonStr);
        this.applyEffectParameters(params);
        this.toastMessage?.show("Smart effects applied!");

        // If effects were not active, activate them to hear the new sound.
        if (!this.isEffectsChainActive) {
            this.toggleEffectsChain(true);
        }

    } catch (e: any) {
        console.error("Error applying smart effects:", e);
        this.toastMessage?.show(`Error: ${e.message || "Could not apply effects."}`);
    } finally {
        this.isEffectsLoading = false;
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
          <button @click=${this.toggleMidi} class=${classMap({ active: this.showMidi })}>MIDI CCs</button>
          <button @click=${this.toggleDevSettings} class=${classMap({ active: this.showDevSettings })}>Dev Settings</button>
          <button @click=${this.togglePresetsPanel} class=${classMap({ active: this.showPresetsPanel })}>Presets</button>
           <button @click=${this.regenerateBoard}>New Board</button>
          <button @click=${this.toggleRecording} class=${classMap({ recording: this.isRecording })}>
            ${this.isRecording ? 'Stop Recording' : 'Record Audio'}
          </button>
          ${this.showMidi
            ? html`
                <select @focus=${this.updateMidiInputs} @change=${this.onMidiInputChange} .value=${this.activeMidiInputId || ''} aria-label="Select MIDI Input">
                  ${this.midiInputIds.map(
                    (id) => html` <option value=${id}>
                      ${this.midiDispatcher.getDeviceName(id) || id}
                    </option>`,
                  )}
                  ${this.midiInputIds.length === 0 ? html`<option value="" disabled>No MIDI devices found</option>` : ''}
                </select>
              `
            : ''}
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
               <small>Changing requires audio restart.</small>
            </div>
             <div class="dev-setting-row">
                <label for="dev-num-channels">Decoding Channels:</label>
                <input type="number" id="dev-num-channels" min="1" max="2" step="1" .value=${this.devNumDecodingChannels.toString()} 
                       @input=${(e: Event) => this.devNumDecodingChannels = parseInt((e.target as HTMLInputElement).value)}>
                 <small>Usually 1 for mono, 2 for stereo Lyria output.</small>
            </div>
            <button @click=${this.applyDevSettings} ?disabled=${!this.devSettingsHaveChanged}>Apply Dev Settings</button>
          </div>
        ` : ''}
         ${this.showPresetsPanel ? html`
          <div class="presets-panel">
            <h3>Manage Presets</h3>
            <div class="dev-setting-row">
              <input type="text" id="preset-name-input" placeholder="New preset name...">
              <button @click=${this.savePreset} class="button-like">Save Current</button>
            </div>
            ${this.savedPresets.length > 0 ? this.savedPresets.map(preset => html`
              <div class="preset-item">
                <span>${preset.name}</span>
                <button @click=${() => this.loadPreset(preset.name)}>Load</button>
                <button @click=${() => this.deletePreset(preset.name)} style="background-color: #c0392b;">Delete</button>
              </div>
            `) : html`<p>No presets saved yet.</p>`}
          </div>
        ` : ''}
        <div id="connection-status" role="status" aria-live="polite">${this.connectionStatusMessage}</div>
      </div>

      <div id="knob-groups-container">
        ${this.displayKnobGroups.map(group => html`
          <section class="knob-group" aria-labelledby="${group.groupName.replace(/\s+/g, '-').toLowerCase()}-title">
            <h3 id="${group.groupName.replace(/\s+/g, '-').toLowerCase()}-title" class="knob-group-title">${group.groupName}</h3>
            <div class="knobs-container">
              ${group.knobs.map(knobConfig => {
                // Find the full Prompt object from this.prompts using the ccCounter
                // This assumes applyKnobConfiguration assigned CCs in the same iteration order
                const promptDetails = getPromptByCC(ccCounter);
                ccCounter++; // Increment for the next knob overall
                
                if (!promptDetails) {
                  // This case should ideally not be hit if TOTAL_KNOBS are consistently generated
                  // and applyKnobConfiguration correctly maps all of them.
                  console.warn(`Could not find prompt details for CC ${ccCounter -1}, knob:`, knobConfig);
                  return html`<!-- Error: Prompt data missing for ${knobConfig.text} -->`;
                }
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
      
      <div id="effects-panel">
        <h2>Master Effects</h2>
        <div class="effects-controls">
          <textarea id="effects-prompt" 
                    .value=${this.effectsPrompt} 
                    @input=${(e: Event) => this.effectsPrompt = (e.target as HTMLTextAreaElement).value}
                    placeholder="Describe the sound environment... e.g., 'in a large cathedral' or 'gritty lo-fi delay'"
          ></textarea>
          <div class="effects-row">
            <button @click=${this.applySmartEffects} ?disabled=${this.isEffectsLoading}>
              ${this.isEffectsLoading ? html`<div class="loading-spinner"></div>` : ''}
              Apply Effects
            </button>
             <label class="toggle-switch">
                <input type="checkbox" ?checked=${this.isEffectsChainActive} @change=${() => this.toggleEffectsChain()}>
                <span class="slider"></span>
            </label>
            <span>Bypass</span>
          </div>
        </div>
      </div>

      <play-pause-button
        .playbackState=${this.playbackState}
        @click=${this.togglePlayPause}
        aria-label=${this.playbackState === 'playing' || this.playbackState === 'loading' ? 'Pause' : 'Play' }
        aria-pressed=${this.playbackState === 'playing' || this.playbackState === 'loading'}
        role="button">
      </play-pause-button>
      <p class="sr-only">Audio level: ${Math.round(this.audioLevel * 100)}%</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'prompt-dj-midi': PromptDjMidi;
  }
}