import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

let lastPlayedAt = 0;
let soundPromise: Promise<Audio.Sound> | null = null;

async function getDropSound() {
  if (!soundPromise) {
    soundPromise = Audio.Sound.createAsync(require('@/assets/sounds/drop.wav'), {
      volume: 0.45,
      shouldPlay: false,
    }).then(({ sound }) => sound);
  }
  return soundPromise;
}

async function playDrop(volume = 0.45) {
  const now = Date.now();
  if (now - lastPlayedAt < 90) return;
  lastPlayedAt = now;
  try {
    const sound = await getDropSound();
    await sound.setVolumeAsync(volume);
    await sound.replayAsync();
  } catch {
    // Audio feedback is optional; haptics still runs if playback is unavailable.
  }
}

export async function tapFeedback(_label?: string) {
  void Haptics.selectionAsync();
  void playDrop(0.32);
}

export async function successFeedback(_label?: string) {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  void playDrop(0.52);
}

export async function warningFeedback(_label?: string) {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  void playDrop(0.38);
}
