import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  agentModelStore,
  AgentNameEnum,
  getDefaultDisplayNameFromProviderId,
  llmProviderModelNames,
  llmProviderStore,
  ProviderTypeEnum,
  type ProviderConfig,
} from '@extension/storage';

interface ProviderOption {
  id: string;
  name: string;
  config: ProviderConfig;
}

interface ModelSelectorProps {
  onModelConfigured?: () => void;
}

function getProviderModels(providerId: string, config: ProviderConfig): string[] {
  if (config.type === ProviderTypeEnum.AzureOpenAI) {
    return config.azureDeploymentNames || [];
  }

  return config.modelNames || llmProviderModelNames[providerId as keyof typeof llmProviderModelNames] || [];
}

function getDefaultParameters(providerId: string): Record<string, number> {
  return {
    temperature: providerId === ProviderTypeEnum.Ollama ? 0.1 : 0.3,
    topP: providerId === ProviderTypeEnum.Ollama ? 0.85 : 0.85,
  };
}

export default function ModelSelector({ onModelConfigured }: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const models = useMemo(
    () => (selectedProvider ? getProviderModels(selectedProvider.id, selectedProvider.config) : []),
    [selectedProvider],
  );

  const loadOptions = useCallback(async () => {
    const [providerRecord, navigatorModel] = await Promise.all([
      llmProviderStore.getAllProviders(),
      agentModelStore.getAgentModel(AgentNameEnum.MinAgent),
    ]);

    const providerOptions = Object.entries(providerRecord).map(([id, config]) => ({
      id,
      name: config.name || getDefaultDisplayNameFromProviderId(id),
      config,
    }));

    setProviders(providerOptions);

    const initialProviderId = navigatorModel?.provider || providerOptions[0]?.id || '';
    const initialProvider = providerOptions.find(provider => provider.id === initialProviderId);
    const initialModels = initialProvider ? getProviderModels(initialProvider.id, initialProvider.config) : [];

    setSelectedProviderId(initialProviderId);
    setSelectedModel(navigatorModel?.modelName || initialModels[0] || '');
  }, []);

  useEffect(() => {
    loadOptions().catch(error => console.error('Failed to load model selector options:', error));
  }, [loadOptions]);

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find(item => item.id === providerId);
    const providerModels = provider ? getProviderModels(provider.id, provider.config) : [];

    setSelectedProviderId(providerId);
    setSelectedModel(providerModels[0] || '');
  };

  const saveModel = async (modelName = selectedModel, providerId = selectedProviderId) => {
    if (!providerId || !modelName) return;

    setIsSaving(true);
    try {
      const provider = providers.find(item => item.id === providerId);
      await agentModelStore.setAgentModel(AgentNameEnum.MinAgent, {
        provider: providerId,
        modelName,
        parameters: getDefaultParameters(provider?.config.type || providerId),
      });
      setSelectedProviderId(providerId);
      setSelectedModel(modelName);
      onModelConfigured?.();
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const currentLabel = selectedModel || 'Select model';
  const providerLabel = selectedProvider?.name || 'Provider';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(value => !value)}
        className="flex max-w-[220px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm text-white transition-colors hover:border-white/35 hover:bg-white/[0.09]"
        title={currentLabel}>
        <span className="size-1.5 rounded-full bg-white/70" />
        <span className="truncate">{currentLabel}</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-30 mb-3 w-[340px] overflow-hidden rounded-2xl border border-white/10 bg-[#080808] text-white shadow-2xl shadow-black/60">
          <div className="border-b border-white/10 p-3">
            <label
              className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-white/45"
              htmlFor="provider-select">
              Provider
            </label>
            <select
              id="provider-select"
              value={selectedProviderId}
              onChange={event => handleProviderChange(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-white/40">
              {providers.map(provider => (
                <option key={provider.id} value={provider.id} className="bg-black text-white">
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          <div className="p-2">
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Models</span>
              <span className="max-w-[180px] truncate text-xs text-white/40">{providerLabel}</span>
            </div>
            <div className="max-h-64 overflow-y-auto pr-1">
              {models.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-5 text-center text-sm text-white/55">
                  Add model names for this provider in settings.
                </div>
              ) : (
                models.map(model => {
                  const isSelected = selectedProviderId === selectedProvider?.id && model === selectedModel;
                  return (
                    <button
                      key={model}
                      type="button"
                      disabled={isSaving}
                      onClick={() => saveModel(model)}
                      className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                        isSelected ? 'bg-white text-black' : 'text-white/82 hover:bg-white/[0.08] hover:text-white'
                      } disabled:cursor-wait disabled:opacity-60`}>
                      <span className="truncate">{model}</span>
                      {isSelected && <span className="ml-3 text-xs font-medium">Selected</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
