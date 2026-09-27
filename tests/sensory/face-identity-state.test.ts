import { describe, it, expect, beforeEach } from 'vitest';
import {
  FaceIdentityState,
  createFaceIdentityState,
  getFaceIdentityState,
  setFaceIdentityState,
} from '../../src/sensory/face-identity-state.js';

describe('face-identity-state', () => {
  describe('FaceIdentityState class', () => {
    let state: FaceIdentityState;
    let mockNow: number;

    beforeEach(() => {
      mockNow = 1000000;
      state = createFaceIdentityState({
        now: () => mockNow,
      });
    });

    it('initializes with default values', () => {
      expect(state.getRecognized()).toBe(false);
      expect(state.getLastRecognitionTime()).toBeNull();
      expect(state.getTimeSinceRecognition()).toBeNull();
    });

    it('setRecognized(true) updates state correctly', () => {
      state.setRecognized(true);
      expect(state.getRecognized()).toBe(true);
      expect(state.getLastRecognitionTime()).toBe(1000000);
      expect(state.getTimeSinceRecognition()).toBe(0);
    });

    it('setRecognized(false) clears recognition', () => {
      state.setRecognized(true);
      mockNow = 1001000;
      state.setRecognized(false);
      expect(state.getRecognized()).toBe(false);
      expect(state.getLastRecognitionTime()).toBeNull();
      expect(state.getTimeSinceRecognition()).toBeNull();
    });

    it('getTimeSinceRecognition returns correct elapsed time', () => {
      state.setRecognized(true);
      mockNow = 1000500;
      expect(state.getTimeSinceRecognition()).toBe(500);
      mockNow = 1001000;
      expect(state.getTimeSinceRecognition()).toBe(1000);
    });

    it('reset clears all state', () => {
      state.setRecognized(true);
      mockNow = 1000500;
      state.reset();
      expect(state.getRecognized()).toBe(false);
      expect(state.getLastRecognitionTime()).toBeNull();
      expect(state.getTimeSinceRecognition()).toBeNull();
    });

    it('snapshot returns current state', () => {
      state.setRecognized(true);
      mockNow = 1000500;
      const snapshot = state.snapshot();
      expect(snapshot.recognizedOwnerPresent).toBe(true);
      expect(snapshot.lastRecognitionTime).toBe(1000000);
      expect(snapshot.timeSinceRecognition).toBe(500);
    });
  });

  describe('Singleton functions', () => {
    beforeEach(() => {
      setFaceIdentityState(undefined);
    });

    it('getFaceIdentityState creates and returns singleton', () => {
      const state1 = getFaceIdentityState();
      const state2 = getFaceIdentityState();
      expect(state1).toBe(state2);
    });

    it('setFaceIdentityState allows replacing singleton', () => {
      const customState = createFaceIdentityState();
      setFaceIdentityState(customState);
      expect(getFaceIdentityState()).toBe(customState);
    });

    it('createFaceIdentityState creates new instances', () => {
      const state1 = createFaceIdentityState();
      const state2 = createFaceIdentityState();
      expect(state1).not.toBe(state2);
    });
  });
});
