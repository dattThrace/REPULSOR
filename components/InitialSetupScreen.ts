/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { css, html, LitElement } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { ToastMessage } from './ToastMessage';
import './ToastMessage';

// Use process.env.API_KEY as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const GEMINI_MODEL_NAME = 'gemini-2.5-flash';
const TOTAL_KNOBS = 16;
const MAX_SPECIFIC_KNOBS = 4;

// Thematic default color palettes
const STYLE_COLORS = ['#6A5ACD', '#4682B4', '#8A2BE2', '#7B68EE', '#9370DB', '#483D8B', '#BA55D3', '#87CEFA'];
const SONIC_ELEMENT_COLORS = ['#32CD32', '#ADFF2F', '#9ACD32', '#2E8B57', '#3CB371', '#8FBC8F', '#90EE90', '#98FB98'];
const ARRANGEMENT_FLOW_COLORS = ['#FF6347', '#FF8C00', '#FF4500', '#DC143C', '#FF7F50', '#FF69B4', '#FFA07A', '#FFD700'];
const USER_SPECIFIED_COLORS = ['#A9A9A9', '#B0C4DE', '#778899', '#D3D3D3', '#C0C0C0', '#BEBEBE', '#E6E6FA'];


const GROUP_PALETTES: Record<string, string[]> = {
  "Styles": STYLE_COLORS,
  "Sonic Elements": SONIC_ELEMENT_COLORS,
  "Arrangement & Flow": ARRANGEMENT_FLOW_COLORS,
  "User Specified": USER_SPECIFIED_COLORS 
};

const DEFAULT_GROUP_ORDER = ["Styles", "Sonic Elements", "Arrangement & Flow"];


export interface InitialKnobConfig {
  text: string;
  color: string;
}

export interface KnobGroup {
  groupName: string;
  knobs: InitialKnobConfig[];
}

// Define an interface for the expected structure of the parsed Gemini output
interface ParsedKnobOutput {
  knobGroups: KnobGroup[];
}

interface SpecificKnobInput {
  id: number;
  text: string;
}

@customElement('initial-setup-screen')
export class InitialSetupScreen extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      width: 100%;
      background: radial-gradient(circle at 50% 0%, #1a1a1a 0%, #050505 100%);
      color: #fff;
      padding: 24px;
      box-sizing: border-box;
      text-align: center;
      overflow-y: auto;
      font-family: 'Inter', sans-serif;
    }
    .setup-container {
      background: rgba(20, 20, 20, 0.6);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      padding: 40px 24px;
      border-radius: 32px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);
      width: 100%;
      max-width: 400px;
      animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes slideUp {
      from { opacity: 0; transform: translateY(40px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    h2 {
      margin-top: 0;
      font-size: 2.5rem;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.04em;
      background: linear-gradient(135deg, #fff 0%, #a5a5a5 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 12px;
    }
    p {
      color: #888;
      margin-bottom: 40px;
      font-size: 1.05rem;
      line-height: 1.5;
    }
    .form-group {
      margin-bottom: 28px;
      text-align: left;
    }
    label {
      display: block;
      margin-bottom: 10px;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #aaa;
    }
    textarea,
    input[type="text"] {
      width: 100%;
      padding: 16px;
      border-radius: 16px;
      border: 1px solid rgba(255,255,255,0.1);
      background-color: rgba(0,0,0,0.3);
      color: #fff;
      box-sizing: border-box;
      font-size: 1rem;
      transition: all 0.3s ease;
      font-family: inherit;
    }
    textarea:focus,
    input[type="text"]:focus {
      outline: none;
      border-color: #ff4e00;
      background-color: rgba(0,0,0,0.5);
      box-shadow: 0 0 0 4px rgba(255, 78, 0, 0.15);
    }
    textarea {
      min-height: 120px;
      resize: none;
    }
    .specific-knob-input {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      gap: 12px;
    }
    .specific-knob-input input[type="text"] {
      flex-grow: 1;
    }
    .primary-btn {
      width: 100%;
      padding: 18px;
      border-radius: 100px;
      border: none;
      background: #fff;
      color: #000;
      font-size: 1.05rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-top: 24px;
      box-shadow: 0 8px 20px rgba(255,255,255,0.15);
    }
    .primary-btn:hover:not(:disabled) {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 12px 24px rgba(255,255,255,0.2);
    }
    .primary-btn:active:not(:disabled) {
      transform: translateY(0) scale(0.98);
    }
    .primary-btn:disabled {
      background: #333;
      color: #666;
      box-shadow: none;
      cursor: not-allowed;
    }
    .secondary-btn {
      background: transparent;
      color: #888;
      border: none;
      width: 100%;
      padding: 16px;
      margin-top: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.2s;
    }
    .secondary-btn:hover {
      color: #fff;
    }
    .add-knob-btn {
      background-color: transparent;
      color: #ff4e00;
      border: 1px dashed rgba(255, 78, 0, 0.5);
      font-size: 0.9rem;
      padding: 12px;
      margin-top: 0;
      border-radius: 12px;
      width: 100%;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.2s;
    }
    .add-knob-btn:hover:not(:disabled) {
      background-color: rgba(255, 78, 0, 0.1);
      border-color: #ff4e00;
    }
    .remove-knob-btn {
      background-color: rgba(255,255,255,0.05);
      color: #888;
      width: 48px;
      height: 48px;
      padding: 0;
      margin: 0;
      border-radius: 16px;
      border: none;
      font-size: 1.2rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .remove-knob-btn:hover {
      color: #ff4444;
      background-color: rgba(255, 68, 68, 0.1);
    }
    .loading-spinner {
      border: 3px solid rgba(0,0,0,0.1);
      border-top: 3px solid #000;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .creativity-value {
      float: right;
      color: #ff4e00;
      font-family: var(--mono-font);
    }
    small {
      display: block;
      margin-top: 8px;
      color: #666;
      font-size: 0.75rem;
      line-height: 1.4;
    }
    input[type="range"] {
      -webkit-appearance: none;
      height: 4px;
      background: rgba(255,255,255,0.1);
      border-radius: 2px;
      padding: 0;
      margin: 16px 0;
      width: 100%;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 24px;
      height: 24px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid #000;
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.2);
    }
  `;

  @state() private musicStyle = "90s boom-bap hip hop with jazzy samples and a laid-back groove";
  @state() private creativityLevel = 0.9; // Corresponds to Gemini's temperature (0.1 - 2.0)
  @state() private specificKnobs: SpecificKnobInput[] = [{ id: Date.now(), text: "Vinyl Crackle" }];
  @state() private isLoading = false;

  @query('#setup-toast') private toastMessageElement!: ToastMessage;


  private addSpecificKnob() {
    if (navigator.vibrate) navigator.vibrate(10);
    if (this.specificKnobs.length < MAX_SPECIFIC_KNOBS) {
      this.specificKnobs = [...this.specificKnobs, { id: Date.now(), text: "" }];
    } else {
        this.showToast(`You can add a maximum of ${MAX_SPECIFIC_KNOBS} specific knobs.`);
    }
  }

  private removeSpecificKnob(idToRemove: number) {
    if (navigator.vibrate) navigator.vibrate(10);
    this.specificKnobs = this.specificKnobs.filter(knob => knob.id !== idToRemove);
  }

  private handleSpecificKnobChange(id: number, newText: string) {
    this.specificKnobs = this.specificKnobs.map(knob =>
      knob.id === id ? { ...knob, text: newText } : knob
    );
  }

  private showToast(message: string) {
    const mainToast = this.closest('prompt-dj-midi')?.shadowRoot?.querySelector('toast-message') as any;
    if (mainToast && typeof mainToast.show === 'function') {
        mainToast.show(message);
    } else if (this.toastMessageElement && typeof (this.toastMessageElement as any).show === 'function') {
        (this.toastMessageElement as any).show(message);
    } else {
        const tempToast = document.createElement('toast-message') as any;
        document.body.appendChild(tempToast);
        if (typeof tempToast.show === 'function') {
            tempToast.show(message);
        } else {
            // Fallback to alert if even the newly created element doesn't have show
            console.error("ToastMessage component not fully initialized:", message);
        }
        setTimeout(() => tempToast.remove(), 4000);
        console.warn("Toast element not found for message, created temporary toast:", message);
    }
  }

  private quickStart() {
    if (navigator.vibrate) navigator.vibrate(10);
    this.isLoading = true;
    this.showToast("Quick starting with default knobs...");
    
    const fallbackGroups: KnobGroup[] = DEFAULT_GROUP_ORDER.map(name => ({ groupName: name, knobs: [] }));
    const usedColors = new Set<string>();
    for (let i = 0; i < TOTAL_KNOBS; i++) {
        const group = fallbackGroups[i % fallbackGroups.length];
        const palette = GROUP_PALETTES[group.groupName] || STYLE_COLORS;
        const color = this.getNextColorFromPalette(palette, usedColors);
        usedColors.add(color);
        group.knobs.push({ text: `${group.groupName} Default ${Math.floor(i / fallbackGroups.length) + 1}`, color });
    }

    this.dispatchEvent(new CustomEvent<KnobGroup[]>('knobs-generated', {
      detail: fallbackGroups, 
      bubbles: true,
      composed: true,
    }));
  }

  private getNextColorFromPalette(palette: string[], usedColors: Set<string>): string {
    for (const color of palette) {
        if (!usedColors.has(color.toUpperCase())) return color.toUpperCase();
    }
    // Fallback if all palette colors are used (should be rare with enough defaults)
    const fallbackColor = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`.toUpperCase();
    console.warn(`Palette exhausted, using random color: ${fallbackColor}`);
    return fallbackColor;
  }


  private async generateKnobs() {
    if (navigator.vibrate) navigator.vibrate(10);
    this.isLoading = true;
    this.showToast("Generating your custom knobs... this might take a moment!");

    const userKnobTexts = this.specificKnobs.filter(k => k.text.trim() !== "").map(k => k.text.trim());

    const systemInstruction = `You are an expert musical prompt generator for a DJ application.
You will create ${TOTAL_KNOBS} unique knob configurations. Each knob has a "text" (2-5 words) and a "color" (a unique 6-digit hex string like "#RRGGBB").
These ${TOTAL_KNOBS} knobs MUST be categorized into three main groups: "Styles", "Sonic Elements", and "Arrangement & Flow".

- "Styles": For musical genres, overall vibes (e.g., "Deep House Groove", "Ambient Chill"). Colors for this group should be blues and purples (e.g., from ${STYLE_COLORS.slice(0,3).join(', ')}).
- "Sonic Elements": For specific instruments, textures, effects (e.g., "Distorted Bassline", "Sparkling Arp"). Colors for this group should be greens (e.g., from ${SONIC_ELEMENT_COLORS.slice(0,3).join(', ')}).
- "Arrangement & Flow": For song structure, dynamics, energy (e.g., "Build-up Tension", "Sudden Beat Drop"). Colors for this group should be oranges and reds (e.g., from ${ARRANGEMENT_FLOW_COLORS.slice(0,3).join(', ')}).

The user's desired music style is: "${this.musicStyle}". Incorporate this style into your suggestions.

If the user provides specific knob texts, you MUST include them. Attempt to categorize these user-provided texts into one of the three main groups and assign them a thematic color. If a user knob doesn't fit well, you can conceptually assign it to a "User Specified" category but still try to give it a somewhat distinct color (e.g., greys like ${USER_SPECIFIED_COLORS.slice(0,2).join(', ')}).

Generate the remaining knobs to reach a total of ${TOTAL_KNOBS}, distributing them thoughtfully among the three main groups.
Ensure all ${TOTAL_KNOBS} knob texts are unique and all colors are unique.

CRITICAL: You MUST return ONLY a single, valid JSON object.
The JSON object must have a single root key "knobGroups".
The value of "knobGroups" must be an array of group objects.
Each group object in the array must have:
  1. A "groupName" key with a string value (one of "Styles", "Sonic Elements", "Arrangement & Flow", or "User Specified" if necessary for user inputs only).
  2. A "knobs" key with a value that is an array of knob objects.
Each knob object in the "knobs" array must have:
  1. A "text" key with a string value.
  2. A "color" key with a string value (a 6-digit hex color code, e.g., "#RRGGBB").

JSON FORMATTING RULES:
- All keys (like "knobGroups", "groupName", "knobs", "text", "color") and all string values MUST be enclosed in double quotes.
- Commas MUST be used to separate elements within arrays and key-value pairs within objects.
- There MUST NOT be any trailing commas.
- The entire output MUST be a single, valid JSON object, starting with '{' and ending with '}'.
- Do NOT include any other text, explanations, or markdown fences (like \`\`\`json) around the JSON output.

Example of the EXACT expected JSON structure for two groups with one knob each:
{
  "knobGroups": [
    {
      "groupName": "Styles",
      "knobs": [
        {
          "text": "Cool Style Example",
          "color": "#6A5ACD"
        }
      ]
    },
    {
      "groupName": "Sonic Elements",
      "knobs": [
        {
          "text": "Crunchy Sound Bit",
          "color": "#32CD32"
        }
      ]
    }
  ]
}
Now, generate the full ${TOTAL_KNOBS} knobs according to all these rules.`;

    let userPromptContent = `My desired music style: "${this.musicStyle}"\n`;
    if (userKnobTexts.length > 0) {
      userPromptContent += `Please include these specific knob texts, categorize them, and give them unique, thematic colors:\n${userKnobTexts.map(t => `- "${t}"`).join('\n')}\n`;
    }
    userPromptContent += `Generate ${TOTAL_KNOBS} total knobs, grouped as described, following all JSON formatting rules strictly. Ensure distinct colors from appropriate palettes for each group.`;


    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: userPromptContent,
        config: {
          systemInstruction: systemInstruction,
          temperature: this.creativityLevel,
          topP: 0.95,
          responseMimeType: "application/json",
        }
      });

      let jsonStr = response.text.trim();
      const fenceRegex = /^```(?:json)?\s*\n?(.*?)\n?\s*```$/s;
      const match = jsonStr.match(fenceRegex);
      if (match && match[1]) {
        jsonStr = match[1].trim();
      }
      
      console.log("Attempting to parse the following JSON string from Gemini:", jsonStr);
      const parsedOutput: ParsedKnobOutput = JSON.parse(jsonStr);

      if (!parsedOutput || !Array.isArray(parsedOutput.knobGroups)) {
        throw new Error("Gemini response is not in the expected format: { knobGroups: [...] }.");
      }
      
      const finalKnobGroupsObject: Record<string, KnobGroup> = {};
      DEFAULT_GROUP_ORDER.forEach(name => {
        finalKnobGroupsObject[name] = { groupName: name, knobs: [] };
      });
      if (userKnobTexts.length > 0) {
           finalKnobGroupsObject["User Specified"] = { groupName: "User Specified", knobs: [] };
      }


      const allGeneratedKnobsFlat: {text: string, color: string, originalGroupName?: string}[] = [];
      const usedColors = new Set<string>();
      const usedTexts = new Set<string>();

      parsedOutput.knobGroups.forEach(group => {
        const groupName = group.groupName;
        const targetPalette = GROUP_PALETTES[groupName] || USER_SPECIFIED_COLORS;
        
        group.knobs.forEach(knob => {
          if (!usedTexts.has(knob.text.trim().toLowerCase()) && allGeneratedKnobsFlat.length < TOTAL_KNOBS) {
            let color = knob.color.toUpperCase();
            if (!/^#[0-9A-F]{6}$/i.test(color) || usedColors.has(color)) {
              color = this.getNextColorFromPalette(targetPalette, usedColors);
            }
            allGeneratedKnobsFlat.push({ text: knob.text.trim(), color, originalGroupName: groupName });
            usedTexts.add(knob.text.trim().toLowerCase());
            usedColors.add(color);
          }
        });
      });
      
      // Ensure user-specified knobs are present
      userKnobTexts.forEach(userText => {
        if (!usedTexts.has(userText.toLowerCase())) {
          if (allGeneratedKnobsFlat.length >= TOTAL_KNOBS) {
              console.warn(`Max knobs reached, cannot add user specific knob: ${userText}`);
              return;
          }
          const color = this.getNextColorFromPalette(GROUP_PALETTES["User Specified"], usedColors);
          allGeneratedKnobsFlat.push({ text: userText, color, originalGroupName: "User Specified" });
          usedTexts.add(userText.toLowerCase());
          usedColors.add(color);
        }
      });

      // Distribute knobs into final groups
      let knobIdx = 0;
      for (const knob of allGeneratedKnobsFlat) {
          let targetGroupName = knob.originalGroupName && finalKnobGroupsObject[knob.originalGroupName] ? knob.originalGroupName : DEFAULT_GROUP_ORDER[knobIdx % DEFAULT_GROUP_ORDER.length];
          
          // If it's a user-specified text, try to put it in "User Specified" group if that exists
          if (userKnobTexts.includes(knob.text) && finalKnobGroupsObject["User Specified"]) {
              targetGroupName = "User Specified";
          }
           if (finalKnobGroupsObject[targetGroupName]) {
            finalKnobGroupsObject[targetGroupName].knobs.push({ text: knob.text, color: knob.color });
            knobIdx++;
           } else { // Fallback if group name from Gemini was unexpected
            finalKnobGroupsObject[DEFAULT_GROUP_ORDER[knobIdx % DEFAULT_GROUP_ORDER.length]].knobs.push({ text: knob.text, color: knob.color });
            knobIdx++;
           }
      }
      
      // Fill remaining spots if TOTAL_KNOBS not reached
      let totalKnobsCount = Object.values(finalKnobGroupsObject).reduce((sum, group) => sum + group.knobs.length, 0);
      let groupFillIdx = 0;
      while (totalKnobsCount < TOTAL_KNOBS) {
          const targetGroupName = DEFAULT_GROUP_ORDER[groupFillIdx % DEFAULT_GROUP_ORDER.length];
          const targetGroup = finalKnobGroupsObject[targetGroupName];
          const placeholderText = `${targetGroupName} Filler ${targetGroup.knobs.length + 1}`;
          if (usedTexts.has(placeholderText.toLowerCase())) break; // Avoid infinite loop on text collision

          const color = this.getNextColorFromPalette(GROUP_PALETTES[targetGroupName], usedColors);
          targetGroup.knobs.push({ text: placeholderText, color });
          usedTexts.add(placeholderText.toLowerCase());
          usedColors.add(color);
          totalKnobsCount++;
          groupFillIdx++;
      }

      // Trim if too many knobs somehow
       totalKnobsCount = Object.values(finalKnobGroupsObject).reduce((sum, group) => sum + group.knobs.length, 0);
       let trimAttempts = 0;
       while (totalKnobsCount > TOTAL_KNOBS && trimAttempts < TOTAL_KNOBS * 2) {
           for (let i = DEFAULT_GROUP_ORDER.length -1; i >= 0 && totalKnobsCount > TOTAL_KNOBS; i--) {
               const groupName = DEFAULT_GROUP_ORDER[i];
               if (finalKnobGroupsObject[groupName] && finalKnobGroupsObject[groupName].knobs.length > (TOTAL_KNOBS / DEFAULT_GROUP_ORDER.length * 0.5) && finalKnobGroupsObject[groupName].knobs.length > 1) { // Avoid emptying a group if possible
                   const removedKnob = finalKnobGroupsObject[groupName].knobs.pop();
                   if(removedKnob) {
                     usedColors.delete(removedKnob.color);
                     usedTexts.delete(removedKnob.text.toLowerCase());
                     totalKnobsCount--;
                   }
               }
           }
            // If still too many, try User Specified group
           if (finalKnobGroupsObject["User Specified"] && finalKnobGroupsObject["User Specified"].knobs.length > 0 && totalKnobsCount > TOTAL_KNOBS) {
                const removedKnob = finalKnobGroupsObject["User Specified"].knobs.pop();
                if(removedKnob) {
                    usedColors.delete(removedKnob.color);
                    usedTexts.delete(removedKnob.text.toLowerCase());
                    totalKnobsCount--;
                }
           }
           trimAttempts++;
       }


      const finalGroupsArray = DEFAULT_GROUP_ORDER.map(name => finalKnobGroupsObject[name]).filter(g => g && g.knobs.length > 0);
      if (finalKnobGroupsObject["User Specified"] && finalKnobGroupsObject["User Specified"].knobs.length > 0) {
          finalGroupsArray.push(finalKnobGroupsObject["User Specified"]);
      }


      this.dispatchEvent(new CustomEvent<KnobGroup[]>('knobs-generated', {
        detail: finalGroupsArray, 
        bubbles: true,
        composed: true,
      }));

    } catch (error: any) {
      console.error("Error generating knobs with Gemini:", error);
      this.showToast(`Error: ${error.message || 'Could not generate knobs. Please try again.'}`);
      // Fallback: Create simple default groups
      const fallbackGroups: KnobGroup[] = DEFAULT_GROUP_ORDER.map(name => ({ groupName: name, knobs: [] }));
      const usedColors = new Set<string>();
      for (let i = 0; i < TOTAL_KNOBS; i++) {
          const group = fallbackGroups[i % fallbackGroups.length];
          const palette = GROUP_PALETTES[group.groupName] || STYLE_COLORS;
          const color = this.getNextColorFromPalette(palette, usedColors);
          usedColors.add(color);
          group.knobs.push({ text: `${group.groupName} Default ${Math.floor(i / fallbackGroups.length) + 1}`, color });
      }
       this.dispatchEvent(new CustomEvent<KnobGroup[]>('knobs-generated', {
        detail: fallbackGroups, bubbles: true, composed: true,
      }));
    } finally {
      this.isLoading = false;
    }
  }

  override render() {
    return html`
      <div class="setup-container">
        <h2>✨ Personalize Your DJ Setup ✨</h2>
        <p>Describe your sound, and we'll craft the perfect knobs for your session!</p>

        <div class="form-group">
          <label for="music-style">What kind of music do you want to create?</label>
          <textarea
            id="music-style"
            .value=${this.musicStyle}
            @input=${(e: Event) => this.musicStyle = (e.target as HTMLTextAreaElement).value}
            placeholder="e.g., Lo-fi hip hop beats, 90s Memphis rap, Experimental techno"
            rows="3"
            aria-describedby="music-style-desc"
          ></textarea>
          <small id="music-style-desc">Be descriptive! The more detail, the better the knobs.</small>
        </div>

        <div class="form-group">
          <label for="creativity-level">
            Experimentality Level (Temperature):
            <span class="creativity-value">${this.creativityLevel.toFixed(1)}</span>
          </label>
          <input
            type="range"
            id="creativity-level"
            min="0.1"
            max="2.0"
            step="0.1"
            .value=${this.creativityLevel.toString()}
            @input=${(e: Event) => this.creativityLevel = parseFloat((e.target as HTMLInputElement).value)}
            aria-describedby="creativity-desc"
          />
          <small id="creativity-desc">Higher values (e.g., 1.0-2.0) make knob suggestions more wild and unpredictable. Lower values (e.g., 0.1-0.7) are more focused.</small>
        </div>

        <div class="form-group">
          <label>Any specific knobs you'd like to include? (Up to ${MAX_SPECIFIC_KNOBS})</label>
          ${repeat(this.specificKnobs, (knob) => knob.id, (knob, index) => html`
            <div class="specific-knob-input">
              <input
                type="text"
                aria-label="Specific knob text ${index + 1}"
                .value=${knob.text}
                @input=${(e: Event) => this.handleSpecificKnobChange(knob.id, (e.target as HTMLInputElement).value)}
                placeholder="e.g., Cat Meows, 808 Bass Slides"
              />
              <button class="remove-knob-btn" @click=${() => this.removeSpecificKnob(knob.id)} title="Remove this knob" aria-label="Remove knob ${knob.text || 'empty'}">✕</button>
            </div>
          `)}
          ${this.specificKnobs.length < MAX_SPECIFIC_KNOBS ? html`
            <button class="add-knob-btn" @click=${this.addSpecificKnob} title="Add another specific knob">⊕ Add Knob</button>
          ` : ''}
        </div>

        <button class="primary-btn" @click=${this.generateKnobs} ?disabled=${this.isLoading}>
          ${this.isLoading ? html`<div class="loading-spinner"></div> Generating...` : '🎵 Generate My Knobs!'}
        </button>

        <button class="secondary-btn" @click=${this.quickStart} ?disabled=${this.isLoading}>
          Quick Start (Default Knobs)
        </button>
      </div>
      <div id="toast-container"> <!-- This is for the local toast fallback -->
         <toast-message id="setup-toast"></toast-message>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'initial-setup-screen': InitialSetupScreen;
  }
}