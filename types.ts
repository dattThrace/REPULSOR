/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PlaybackState = 'playing' | 'paused' | 'stopped' | 'loading';

export interface Prompt {
  promptId: string;
  text: string;
  weight: number;
  cc: number;
  color: string;
}

export interface ControlChange {
  channel: number;
  cc: number;
  value: number;
}
