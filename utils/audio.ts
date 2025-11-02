/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import {Blob} from '@google/genai';

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // convert float32 -1 to 1 to int16 -32768 to 32767
    int16[i] = Math.max(-32768, Math.min(32767, data[i] * 32768));
  }

  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000', // Assuming 16kHz for this function's original context
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  // Ensure data length is even for Int16Array conversion and divisible by numChannels
  let validLength = data.length;
  if (validLength % 2 !== 0) validLength -=1; // Make it even
  if (numChannels > 0 && (validLength / 2) % numChannels !== 0) {
      validLength = Math.floor((validLength / 2) / numChannels) * numChannels * 2;
  }
  
  if (validLength === 0) {
      console.warn("decodeAudioData: Not enough data to process after validation for channels.");
      // Return a very short, silent buffer to avoid errors downstream
      return ctx.createBuffer(numChannels || 1, 1, sampleRate);
  }

  const dataView = new DataView(data.buffer, data.byteOffset, validLength);
  const dataInt16 = new Int16Array(dataView.buffer, dataView.byteOffset, validLength / 2);

  const buffer = ctx.createBuffer(
    numChannels,
    dataInt16.length / numChannels,
    sampleRate,
  );

  const dataFloat32 = new Float32Array(dataInt16.length);
  for (let i = 0; i < dataInt16.length; i++) {
    dataFloat32[i] = dataInt16[i] / 32768.0;
  }
  
  if (numChannels === 1) { // Optimized for mono
    buffer.copyToChannel(dataFloat32, 0);
  } else { // Handle multi-channel
    for (let i = 0; i < numChannels; i++) {
      const channelData = new Float32Array(dataFloat32.length / numChannels);
      for (let j = 0; j < channelData.length; j++) {
        channelData[j] = dataFloat32[j * numChannels + i];
      }
      buffer.copyToChannel(channelData, i);
    }
  }
  return buffer;
}

// --- WAV Encoding ---
function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function encodeWAV(audioBuffer: AudioBuffer): globalThis.Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const samplesPerChannel = audioBuffer.length;
  const blockAlign = numChannels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samplesPerChannel * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  writeString(view, 8, 'WAVE');

  // FMT sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // DATA sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write interleaved PCM data
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < samplesPerChannel; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new (self.Blob)([view], { type: 'audio/wav' });
}


export {createBlob, decode, decodeAudioData, encode, encodeWAV};