/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generates an impulse response AudioBuffer for use with a ConvolverNode.
 * This creates a synthetic reverb effect without needing external files.
 * 
 * @param type The type of impulse response to generate.
 * @param audioContext The AudioContext to create the buffer in.
 * @returns An AudioBuffer containing the generated impulse response.
 */
export function generateImpulseResponse(
  type: 'cathedral' | 'small_room' | 'cave' | 'none',
  audioContext: AudioContext
): AudioBuffer | null {
  if (type === 'none') {
    // Return a buffer with a single '1' to act as a passthrough if needed, 
    // though typically the convolver would just be disconnected.
    const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
    buffer.getChannelData(0)[0] = 1;
    return buffer;
  }

  const sampleRate = audioContext.sampleRate;
  let duration: number;
  let decay: number;
  const numChannels = 2; // Stereo

  switch (type) {
    case 'cathedral':
      duration = 4.0; // seconds
      decay = 2.0;
      break;
    case 'small_room':
      duration = 0.8;
      decay = 1.5;
      break;
    case 'cave':
      duration = 2.5;
      decay = 2.5;
      break;
    default:
      duration = 1.0;
      decay = 1.0;
  }

  const length = sampleRate * duration;
  const impulse = audioContext.createBuffer(numChannels, length, sampleRate);
  
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      // Create decaying noise
      const noise = Math.random() * 2 - 1;
      const envelope = Math.pow(1 - i / length, decay);
      channelData[i] = noise * envelope;
    }
  }

  return impulse;
}
