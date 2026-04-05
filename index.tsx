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
    * {
      box-sizing: border-box;
    }
    :host {
      --mono-font: 'JetBrains Mono', 'Roboto Mono', monospace;
      --accent: #fff;
      --bg: #000;
      --panel-bg: #111;
      --glass: transparent;
      --glass-border: #333;
      
      height: 100%;
      width: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      position: relative;
      background: var(--bg);
      color: #fff;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      overflow: hidden;
    }
    
    #app-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--glass-border);
    }

    #app-title {
      font-weight: 900;
      font-size: 1.2rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #fff;
    }

    #connection-status {
      font-family: var(--mono-font);
      font-size: 0.6rem;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      display: flex;
      align-items: center;
      gap: 8px;
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
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      scroll-behavior: smooth;
    }

    @media (min-width: 768px) {
      #main-stage {
        padding: 60px;
      }
    }

    #knob-groups-container {
      display: flex;
      flex-direction: column;
      gap: 40px;
      width: 100%;
      max-width: 1200px;
      animation: fadeIn 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .knob-group {
      background: var(--panel-bg);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid var(--glass-border);
      width: 100%;
    }

    @media (min-width: 768px) {
      .knob-group {
        padding: 40px;
      }
    }

    .knob-group:hover {
      border-color: #555;
    }

    .knob-group-title {
      color: #fff;
      font-size: 0.75rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      margin-top: 0;
      margin-bottom: 24px;
      text-align: left;
      opacity: 0.5;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .knob-group-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(to right, rgba(255,255,255,0.1), transparent);
    }

    .knobs-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
      gap: 16px;
      justify-items: center;
    }

    @media (min-width: 480px) {
      .knobs-container {
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 24px;
      }
    }

    prompt-controller {
      width: 100%;
    }

    weight-history-graph {
      width: 100%;
      max-width: 1200px;
      height: 200px;
      margin-top: 40px;
      background-color: var(--panel-bg);
      border-radius: 16px;
      border: 1px solid var(--glass-border);
      overflow: hidden;
    }

    .app-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .sidebar {
      width: 320px;
      flex-shrink: 0;
      background: var(--panel-bg);
      border-right: 1px solid var(--glass-border);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      padding: 24px;
      gap: 32px;
      z-index: 100;
    }

    .sidebar-sections {
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    .main-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-y: auto;
      background: var(--bg);
    }

    .sidebar-section {
      display: flex;
      flex-direction: column;
    }

    .sidebar-title {
      font-size: 0.85rem;
      font-weight: 700;
      margin: 0 0 16px 0;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #888;
    }

    .transport-controls {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      background: var(--bg);
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--glass-border);
    }

    .icon-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #888;
      flex: 1;
      height: 56px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
      gap: 4px;
    }
    .icon-btn span {
      font-size: 0.55rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
    }
    .icon-btn:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .icon-btn.active {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.3);
    }
    .icon-btn.recording {
      background: rgba(255, 68, 68, 0.15);
      color: #ff4444;
      border-color: rgba(255, 68, 68, 0.3);
      animation: pulse-record 2s infinite;
    }

    @media (max-width: 768px) {
      .app-layout {
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        width: 100%;
      }
      .sidebar {
        display: contents;
      }
      #app-header {
        order: 1;
        background: var(--panel-bg);
        padding: 16px 16px 0 16px;
        margin: 0;
        border-bottom: none;
      }
      .transport-controls {
        order: 2;
        background: var(--panel-bg);
        padding: 16px;
        margin: 0;
        border: none;
        border-radius: 0;
        border-bottom: 1px solid var(--glass-border);
        gap: 8px;
      }
      .main-content {
        order: 3;
        overflow-y: visible;
        min-height: auto;
        width: 100%;
      }
      #main-stage {
        padding: 16px;
        width: 100%;
      }
      .sidebar-sections {
        order: 4;
        background: var(--panel-bg);
        padding: 24px 16px;
        display: flex;
        flex-direction: column;
        gap: 32px;
        border-top: 1px solid var(--glass-border);
      }
      .icon-btn {
        height: 48px;
      }
      .knob-group {
        padding: 16px;
      }
      #knob-groups-container {
        gap: 24px;
      }
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      box-sizing: border-box;
    }

    .modal-content {
      background: #111;
      border: 1px solid #333;
      border-radius: 16px;
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

    .dev-setting-row {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 24px;
      background: var(--bg);
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--glass-border);
    }
    .dev-setting-row label {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #666;
      transition: color 0.2s ease;
    }
    .dev-setting-row.changed label {
      color: var(--accent);
    }
    .dev-setting-row.changed label::after {
      content: ' •';
      font-weight: bold;
    }
    .dev-setting-row input:not([type="range"]):not([type="checkbox"]), .dev-setting-row select {
      background: var(--panel-bg);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-size: 0.95rem;
      font-family: var(--mono-font);
      transition: all 0.2s;
    }
    .dev-setting-row input:focus, .dev-setting-row select:focus {
      outline: none;
      border-color: var(--accent);
      background: var(--bg);
    }
    
    .dev-setting-row input[type="range"] {
      padding: 0;
      height: 4px;
      background: #333;
      border: none;
      border-radius: 4px;
      appearance: none;
      margin: 12px 0;
    }
    .dev-setting-row input[type="range"]::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid #000;
      transition: transform 0.2s;
    }
    .dev-setting-row input[type="range"]::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }
    .dev-setting-row span {
      font-family: var(--mono-font);
      font-size: 0.7rem;
      color: var(--accent);
      font-weight: 700;
      text-align: right;
    }

    .primary-btn {
      background: #fff;
      color: #000;
      border: 1px solid #fff;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      cursor: pointer;
      width: 100%;
      margin-top: 8px;
      transition: all 0.2s;
    }
    .primary-btn:hover:not(:disabled) {
      background: #000;
      color: #fff;
    }
    .primary-btn:active:not(:disabled) {
      transform: translateY(1px);
    }
    .primary-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .preset-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: var(--bg);
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      font-size: 0.95rem;
      margin-bottom: 8px;
      transition: all 0.2s;
      cursor: pointer;
    }
    .preset-item:hover {
      border-color: #555;
    }
    .preset-item:active {
      transform: translateY(1px);
    }
    .preset-item.active {
      border-color: #fff;
    }
    .preset-item .preset-name {
      font-weight: 700;
      color: #fff;
      letter-spacing: -0.01em;
    }
    .preset-actions {
      display: flex;
      gap: 10px;
    }
    .preset-item button {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      color: #888;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .preset-item button:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .preset-item button.del-btn {
      background: rgba(255, 68, 68, 0.05);
      border-color: rgba(255, 68, 68, 0.1);
      color: #ff4444;
    }
    .preset-item button.del-btn:hover {
      background: rgba(255, 68, 68, 0.15);
      color: #fff;
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

  @state() private devModelName = DEFAULT_MODEL_NAME;
  @state() private activeModelNameInSession: string = DEFAULT_MODEL_NAME;
  @state() private devClientBufferTime = DEFAULT_CLIENT_BUFFER_TIME;
  @state() private devAudioContextSampleRate = DEFAULT_SAMPLE_RATE;
  @state() private devNumDecodingChannels = DEFAULT_NUM_CHANNELS;
  @state() private connectionStatusMessage = 'Awaiting setup...';
  @state() private devSettingsHaveChanged = false;

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
  @state() private requiresRestartConfigChanged = false;

  private appliedBpm = 120;
  private appliedScale = 'SCALE_UNSPECIFIED';
  private appliedMusicStyle = '';

  @state() private promptWeightHistory: Map<string, Array<{ time: number, weight: number }>> = new Map();
  private historyIntervalId: number | null = null;

  @state() private mixingStrategy: 'linear' | 'power' | 'softmax' = 'linear';
  @state() private mixingTemperature = 1.0;
  @state() private mixingPower = 2.0;

  @state() private hapticsEnabled = true;
  @state() private musicStyle = '';
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
    this.connectionStatusMessage = "Setup complete. Connecting...";
    
    if (!this.audioContext || this.audioContext.state === 'closed') {
        this.initAudioSystem();
    }
    if (this.historyIntervalId) clearInterval(this.historyIntervalId);
    this.promptWeightHistory = new Map(); 
    this.historyIntervalId = window.setInterval(this.samplePromptWeightsForHistory, HISTORY_SAMPLE_INTERVAL_MS);
    this._updateDevSettingsChangedStatus();

    // Automatically start playback
    setTimeout(() => {
      if (this.playbackState === 'stopped') {
        this.togglePlayPause();
      } else if (this.session && this.serverSetupComplete && (this.playbackState === 'playing' || this.playbackState === 'paused')) {
        this.setSessionPrompts();
      }
    }, 500);
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
              this.appliedMusicStyle = this.musicStyle;

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
      text: this.musicStyle.trim() !== '' ? `${this.musicStyle.trim()}, ${p.text}` : p.text,
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

  private handleHistoryClick(e: CustomEvent) {
    const clickedTime = e.detail.time;
    
    // For each prompt, find the point closest to the clicked time
    this.prompts.forEach((prompt, promptId) => {
      const historyPoints = this.promptWeightHistory.get(promptId);
      if (historyPoints && historyPoints.length > 0) {
        // Find the closest point in time
        let closestPoint = historyPoints[0];
        let minDiff = Math.abs(closestPoint.time - clickedTime);
        
        for (let i = 1; i < historyPoints.length; i++) {
          const diff = Math.abs(historyPoints[i].time - clickedTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestPoint = historyPoints[i];
          }
        }
        
        prompt.weight = closestPoint.weight;
      }
    });
    
    this.requestUpdate();
    this.setSessionPrompts();
    this.toastMessage?.show?.("Restored mix from history.");
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

  private discardDevSettings() {
    this.devModelName = this.activeModelNameInSession;
    this._updateDevSettingsChangedStatus();
    this.toastMessage?.show?.("Settings changes discarded.");
  }

  private discardMusicConfig() {
    this.devBpm = this.appliedBpm;
    this.devScale = this.appliedScale;
    this.musicStyle = this.appliedMusicStyle;
    this.requiresRestartConfigChanged = false;
    this.toastMessage?.show?.("Music config changes discarded.");
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

  private applyInstantMusicConfig = throttle(async () => {
    if (!this.session || this.connectionError) return;

    try {
      const config: any = {
        guidance: this.devGuidance,
        bpm: this.appliedBpm, // Use applied BPM to avoid triggering restart
        density: this.devDensity,
        brightness: this.devBrightness,
        muteBass: this.devMuteBass,
        muteDrums: this.devMuteDrums,
        onlyBassAndDrums: this.devOnlyBassAndDrums,
        musicGenerationMode: this.devMusicGenerationMode,
        temperature: this.devTemperature,
        topK: this.devTopK,
      };

      if (this.appliedScale !== 'SCALE_UNSPECIFIED') {
        config.scale = this.appliedScale;
      }

      if (this.devSeed !== -1) {
        config.seed = this.devSeed;
      }

      await this.session.setMusicGenerationConfig({
        musicGenerationConfig: config
      });
    } catch (e) {
      console.error("[Lyria Debug] Error applying instant music config:", e);
    }
  }, 200);

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

      if (this.devBpm !== this.appliedBpm || this.devScale !== this.appliedScale || this.musicStyle !== this.appliedMusicStyle) {
        console.log("[Lyria Debug] Resetting context for new BPM, Scale, or Style...");
        await this.session.resetContext();
        this.appliedBpm = this.devBpm;
        this.appliedScale = this.devScale;
        this.appliedMusicStyle = this.musicStyle;
      }
      
      await this.setSessionPrompts();

      this.requiresRestartConfigChanged = false;
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
  
  private randomizeMix() {
    this.prompts.forEach(prompt => {
      prompt.weight = Math.random();
    });
    this.requestUpdate();
    this.setSessionPrompts();
    this.toastMessage?.show?.("Mix randomized.");
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
    
    // Pre-calculate a map of CC to Prompt for O(1) lookup during render
    const ccToPromptMap = new Map<number, Prompt>();
    for (const prompt of this.prompts.values()) {
      ccToPromptMap.set(prompt.cc, prompt);
    }

    let ccCounter = 0; // To assign CCs sequentially while rendering grouped knobs

    return html`
      <div id="background"></div>
      <toast-message></toast-message>

      <div class="app-layout">
        <aside class="sidebar">
          <header id="app-header">
            <div id="app-title">PROMPT DJ</div>
            <div id="connection-status" role="status" aria-live="polite">
              <div class="status-dot ${this.connectionError ? 'error' : (this.serverSetupComplete ? 'active' : '')}"></div>
              ${this.connectionStatusMessage}
            </div>
          </header>

          <div class="transport-controls">
            <play-pause-button
              .playbackState=${this.playbackState}
              @click=${this.togglePlayPause}
              aria-label=${this.playbackState === 'playing' || this.playbackState === 'loading' ? 'Pause' : 'Play' }
              aria-pressed=${this.playbackState === 'playing' || this.playbackState === 'loading'}
              role="button">
            </play-pause-button>
            <button @click=${this.toggleRecording} class="icon-btn ${classMap({ recording: this.isRecording })}" aria-label="Record">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
              <span>${this.isRecording ? 'Stop' : 'Rec'}</span>
            </button>
            <button @click=${this.toggleMidi} class="icon-btn ${classMap({ active: this.showMidi })}" aria-label="MIDI">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="8" y1="2" x2="8" y2="22"></line><line x1="16" y1="2" x2="16" y2="22"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
              <span>MIDI</span>
            </button>
          </div>

          <div class="sidebar-sections">
            <section class="sidebar-section">
              <h2 class="sidebar-title">Music Config</h2>
            <div style="margin-bottom: 24px;">
              <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 12px;">Instant Adjustments</h3>
              <div class="dev-setting-row">
                <label>Density <span style="float: right; color: var(--accent);">${this.devDensity.toFixed(2)}</span></label>
                <input type="range" min="0" max="1" step="0.05" .value=${this.devDensity.toString()} 
                       @input=${(e: Event) => { this.devDensity = parseFloat((e.target as HTMLInputElement).value); this.applyInstantMusicConfig(); }}>
              </div>
              <div class="dev-setting-row">
                <label>Brightness <span style="float: right; color: var(--accent);">${this.devBrightness.toFixed(2)}</span></label>
                <input type="range" min="0" max="1" step="0.05" .value=${this.devBrightness.toString()} 
                       @input=${(e: Event) => { this.devBrightness = parseFloat((e.target as HTMLInputElement).value); this.applyInstantMusicConfig(); }}>
              </div>
              <div class="dev-setting-row" style="flex-direction: row; align-items: center; justify-content: space-between;">
                <label style="margin: 0;">Mute Bass</label>
                <input type="checkbox" .checked=${this.devMuteBass} 
                       @change=${(e: Event) => { this.devMuteBass = (e.target as HTMLInputElement).checked; this.applyInstantMusicConfig(); }}>
              </div>
              <div class="dev-setting-row" style="flex-direction: row; align-items: center; justify-content: space-between;">
                <label style="margin: 0;">Mute Drums</label>
                <input type="checkbox" .checked=${this.devMuteDrums} 
                       @change=${(e: Event) => { this.devMuteDrums = (e.target as HTMLInputElement).checked; this.applyInstantMusicConfig(); }}>
              </div>
              <div class="dev-setting-row">
                <label>Temperature <span style="float: right; color: var(--accent);">${this.devTemperature.toFixed(1)}</span></label>
                <input type="range" min="0" max="3" step="0.1" .value=${this.devTemperature.toString()} 
                       @input=${(e: Event) => { this.devTemperature = parseFloat((e.target as HTMLInputElement).value); this.applyInstantMusicConfig(); }}>
              </div>
            </div>

            <div style="margin-bottom: 12px;">
              <h3 style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 12px;">Requires Restart</h3>
              <div class="dev-setting-row ${classMap({ changed: this.musicStyle !== this.appliedMusicStyle })}">
                <label>Music Style</label>
                <textarea style="min-height: 80px; resize: none; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 10px 14px; color: #fff; font-family: var(--mono-font); font-size: 0.95rem; width: 100%; box-sizing: border-box;" @input=${(e: any) => { this.musicStyle = e.target.value; this.requiresRestartConfigChanged = true; }}>${this.musicStyle}</textarea>
              </div>
              <div class="dev-setting-row ${classMap({ changed: this.devBpm !== this.appliedBpm })}">
                <label>BPM (60-200)</label>
                <input type="number" min="60" max="200" step="1" .value=${this.devBpm.toString()} 
                       @input=${(e: Event) => { this.devBpm = parseInt((e.target as HTMLInputElement).value); this.requiresRestartConfigChanged = true; }}>
              </div>
              <div class="dev-setting-row ${classMap({ changed: this.devScale !== this.appliedScale })}">
                <label>Scale</label>
                <select @change=${(e: Event) => { this.devScale = (e.target as HTMLSelectElement).value; this.requiresRestartConfigChanged = true; }}>
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
            </div>
            
            <div style="display: flex; gap: 12px; margin-top: 12px;">
              <button class="primary-btn" style="margin: 0; flex: 1;" @click=${this.applyMusicConfig} ?disabled=${!this.requiresRestartConfigChanged}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Apply
              </button>
              <button class="primary-btn" style="margin: 0; flex: 1; background: var(--surface-light); color: var(--text-primary);" @click=${this.discardMusicConfig} ?disabled=${!this.requiresRestartConfigChanged}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                Discard
              </button>
            </div>
          </section>

          <section class="sidebar-section">
            <h2 class="sidebar-title">Settings</h2>
            <div class="dev-setting-row">
              <label>MIDI Input</label>
              <select @change=${(e: any) => { this.activeMidiInputId = e.target.value; this.midiDispatcher.activeMidiInputId = e.target.value; }}>
                <option value="">None</option>
                ${this.midiInputIds.map(id => html`
                  <option value=${id} ?selected=${this.activeMidiInputId === id}>${id}</option>
                `)}
              </select>
            </div>
            <div class="dev-setting-row ${classMap({ changed: this.devModelName !== this.activeModelNameInSession })}">
              <label>Gemini Model</label>
              <select @change=${(e: any) => { this.devModelName = e.target.value; this._updateDevSettingsChangedStatus(); }}>
                <option value="gemini-3-flash-preview" ?selected=${this.devModelName === 'gemini-3-flash-preview'}>Gemini 3 Flash</option>
                <option value="gemini-3.1-pro-preview" ?selected=${this.devModelName === 'gemini-3.1-pro-preview'}>Gemini 3.1 Pro</option>
              </select>
            </div>
            <div class="dev-setting-row" style="flex-direction: row; align-items: center; justify-content: space-between;">
              <label style="margin: 0;">Haptic Feedback</label>
              <input type="checkbox" .checked=${this.hapticsEnabled} @change=${(e: any) => this.hapticsEnabled = e.target.checked}>
            </div>
            <div style="display: flex; gap: 12px; margin-top: 24px;">
              <button class="primary-btn" style="margin: 0; flex: 1;" @click=${this.applyDevSettings} ?disabled=${!this.devSettingsHaveChanged}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Apply
              </button>
              <button class="primary-btn" style="margin: 0; flex: 1; background: var(--surface-light); color: var(--text-primary);" @click=${this.discardDevSettings} ?disabled=${!this.devSettingsHaveChanged}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                Discard
              </button>
            </div>
            <button class="primary-btn" style="margin-top: 12px; background: var(--surface-light); color: var(--text-primary);" @click=${this.randomizeMix}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18h2c4.3 0 6-7 10-7s5.7 7 10 7h2"></path><path d="M2 6h2c4.3 0 6 7 10 7s5.7-7 10-7h2"></path><circle cx="21" cy="6" r="2"></circle><circle cx="21" cy="18" r="2"></circle><circle cx="3" cy="6" r="2"></circle><circle cx="3" cy="18" r="2"></circle></svg>
              Randomize Mix
            </button>
            <button class="primary-btn" style="margin-top: 12px; background: var(--surface-light); color: var(--text-primary);" @click=${this.regenerateBoard}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              Regenerate Board
            </button>
          </section>

          <section class="sidebar-section">
            <h2 class="sidebar-title">Presets</h2>
            <div class="dev-setting-row" style="flex-direction: row; gap: 12px; margin-bottom: 24px;">
              <input type="text" id="preset-name-input" placeholder="Name..." style="flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; color: #fff;">
              <button class="primary-btn" style="width: auto; margin: 0; padding: 0 24px; height: 44px; border-radius: 12px;" @click=${this.savePreset}>Save</button>
            </div>
            <div style="max-height: 40vh; overflow-y: auto; padding-right: 4px;">
              ${this.savedPresets.length > 0 ? this.savedPresets.map(preset => html`
                <div class="preset-item" @click=${() => this.loadPreset(preset.name)}>
                  <span class="preset-name">${preset.name}</span>
                  <div class="preset-actions">
                    <button class="del-btn" @click=${(e: Event) => { e.stopPropagation(); this.deletePreset(preset.id!, preset.name); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </div>
                </div>
              `) : html`<p style="color: #444; font-size: 0.9rem; text-align: center; margin-top: 32px;">No presets saved yet.</p>`}
            </div>
          </section>
          </div>
        </aside>

        <main class="main-content" id="main-stage">
          <div id="knob-groups-container">
            ${this.displayKnobGroups.map(group => html`
              <section class="knob-group" aria-labelledby="${group.groupName.replace(/\s+/g, '-').toLowerCase()}-title">
                <h3 id="${group.groupName.replace(/\s+/g, '-').toLowerCase()}-title" class="knob-group-title">${group.groupName}</h3>
                <div class="knobs-container">
                  ${group.knobs.map(() => {
                    const promptDetails = ccToPromptMap.get(ccCounter);
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
              .playbackStateForOverlay=${this.playbackState}
              @history-click=${this.handleHistoryClick}>
          </weight-history-graph>
        </main>
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