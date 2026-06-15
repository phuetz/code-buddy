import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX, Settings2 } from 'lucide-react';
import { useAppStore } from '../../store';
import { SettingsContentSection } from './shared';

export function SettingsAudio() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const ttsEnabled = settings.ttsEnabled ?? false;
  const piperModel = settings.piperModel ?? 'en_US-lessac-medium';
  const piperSpeed = settings.piperSpeed ?? 1.0;

  const handleToggle = () => {
    updateSettings({ ttsEnabled: !ttsEnabled });
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ piperModel: e.target.value });
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateSettings({ piperSpeed: parseFloat(e.target.value) });
  };

  return (
    <div className="space-y-6">
      <SettingsContentSection
        title={t('settings.audio.ttsTitle', 'Text-to-Speech (Piper)')}
        description={t('settings.audio.ttsDesc', 'Enable local voice synthesis using Piper TTS. Processing is done entirely offline.')}
      >
        <div className="flex items-center justify-between p-4 rounded-lg bg-background border border-border-subtle">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-md ${ttsEnabled ? 'bg-accent/10 text-accent' : 'bg-surface-muted text-text-muted'}`}>
              {ttsEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">
                {t('settings.audio.enableVoice', 'Enable Agent Voice')}
              </p>
              <p className="text-xs text-text-muted">
                {ttsEnabled ? t('settings.audio.voiceOn', 'Voice is currently active') : t('settings.audio.voiceOff', 'Agent is muted')}
              </p>
            </div>
          </div>
          <button
            onClick={handleToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none flex-shrink-0 ${
              ttsEnabled ? 'bg-accent' : 'bg-surface-muted'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                ttsEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </SettingsContentSection>

      {ttsEnabled && (
        <>
          <SettingsContentSection
            title={t('settings.audio.voiceModel', 'Voice Model')}
            description={t('settings.audio.voiceModelDesc', 'Select the Piper acoustic model to use.')}
          >
            <div className="p-4 rounded-lg bg-background border border-border-subtle space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('settings.audio.selectModel', 'Model Name')}
                </label>
                <div className="relative">
                  <select
                    value={piperModel}
                    onChange={handleModelChange}
                    className="w-full pl-3 pr-8 py-2 rounded-md border border-border-subtle bg-surface text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none appearance-none transition-shadow"
                  >
                    <optgroup label="English">
                      <option value="en_US-lessac-medium">en_US-lessac-medium (Female)</option>
                      <option value="en_US-libritts-high">en_US-libritts-high (Multi)</option>
                      <option value="en_GB-alba-medium">en_GB-alba-medium (Female)</option>
                    </optgroup>
                    <optgroup label="French">
                      <option value="fr_FR-upmc-medium">fr_FR-upmc-medium (Female)</option>
                      <option value="fr_FR-siwis-low">fr_FR-siwis-low (Female)</option>
                      <option value="fr_FR-tom-medium">fr_FR-tom-medium (Male)</option>
                    </optgroup>
                  </select>
                  <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                    <Settings2 className="w-4 h-4 text-text-muted" />
                  </div>
                </div>
              </div>
            </div>
          </SettingsContentSection>

          <SettingsContentSection
            title={t('settings.audio.playbackSpeed', 'Playback Speed')}
            description={t('settings.audio.playbackSpeedDesc', 'Adjust the speech rate of the agent.')}
          >
            <div className="p-4 rounded-lg bg-background border border-border-subtle space-y-4">
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-2">
                  <span>0.5x</span>
                  <span className="font-medium text-accent">{piperSpeed.toFixed(1)}x</span>
                  <span>2.0x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={piperSpeed}
                  onChange={handleSpeedChange}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>
            </div>
          </SettingsContentSection>
        </>
      )}
    </div>
  );
}
