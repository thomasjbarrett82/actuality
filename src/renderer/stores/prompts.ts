// Questions the session flows ask with their own dialogs (03 §7): the encryption password.
import { defineStore } from 'pinia';
import { shallowRef } from 'vue';

export interface EncryptionAnswer {
  password: string;
  remember: boolean;
}

interface EncryptionQuestion {
  name: string;
  /** The last password didn't work. */
  retry: boolean;
  resolve: (answer: EncryptionAnswer | null) => void;
}

export const usePrompts = defineStore('prompts', () => {
  const encryption = shallowRef<EncryptionQuestion | null>(null);

  /** "This budget is encrypted" (03 §7). Resolves null on Cancel. */
  function askEncryptionPassword(name: string, retry: boolean): Promise<EncryptionAnswer | null> {
    encryption.value?.resolve(null);
    return new Promise((resolve) => {
      encryption.value = { name, retry, resolve };
    });
  }

  function answerEncryption(answer: EncryptionAnswer | null): void {
    const q = encryption.value;
    encryption.value = null;
    q?.resolve(answer);
  }

  return { encryption, askEncryptionPassword, answerEncryption };
});
