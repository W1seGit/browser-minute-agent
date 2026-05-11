import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  agentModelStore,
  AgentNameEnum,
  getDefaultAgentModelParams,
  getDefaultDisplayNameFromProviderId,
  llmProviderStore,
  piModelRegistry,
  ProviderTypeEnum,
  type PiRegistryProvider,
  type ProviderConfig,
} from '@extension/storage';

interface ProviderOption {
  id: string;
  name: string;
  config: ProviderConfig;
}

interface ModelOption {
  providerId: string;
  providerName: string;
  providerType: string;
  model: string;
}

interface ModelSelectorProps {
  onModelConfigured?: () => void;
}

const providerToPiProvider: Partial<Record<ProviderTypeEnum, PiRegistryProvider>> = {
  [ProviderTypeEnum.OpenAI]: 'openai',
  [ProviderTypeEnum.Anthropic]: 'anthropic',
  [ProviderTypeEnum.DeepSeek]: 'deepseek',
  [ProviderTypeEnum.Gemini]: 'google',
  [ProviderTypeEnum.Grok]: 'xai',
  [ProviderTypeEnum.Xai]: 'xai',
  [ProviderTypeEnum.Groq]: 'groq',
  [ProviderTypeEnum.Cerebras]: 'cerebras',
  [ProviderTypeEnum.Ollama]: 'openrouter',
  [ProviderTypeEnum.AzureOpenAI]: 'azure-openai-responses',
  [ProviderTypeEnum.OpenRouter]: 'openrouter',
  [ProviderTypeEnum.Llama]: 'openrouter',
  [ProviderTypeEnum.Fireworks]: 'fireworks',
  [ProviderTypeEnum.Together]: 'openrouter',
  [ProviderTypeEnum.Mistral]: 'mistral',
  [ProviderTypeEnum.Nebius]: 'openrouter',
  [ProviderTypeEnum.Zai]: 'zai',
  [ProviderTypeEnum.BigModel]: 'zai',
  [ProviderTypeEnum.Aliyun]: 'openrouter',
  [ProviderTypeEnum.Cohere]: 'openrouter',
  [ProviderTypeEnum.OllamaCloud]: 'openrouter',
  [ProviderTypeEnum.GithubCopilot]: 'github-copilot',
  [ProviderTypeEnum.AmazonBedrock]: 'amazon-bedrock',
  [ProviderTypeEnum.CloudflareWorkersAI]: 'cloudflare-workers-ai',
  [ProviderTypeEnum.CloudflareAIGateway]: 'cloudflare-ai-gateway',
  [ProviderTypeEnum.GoogleVertex]: 'google-vertex',
  [ProviderTypeEnum.VercelAIGateway]: 'vercel-ai-gateway',
  [ProviderTypeEnum.OpenAICodex]: 'openai-codex',
  [ProviderTypeEnum.OpenCode]: 'opencode',
  [ProviderTypeEnum.OpenCodeGo]: 'opencode-go',
  [ProviderTypeEnum.HuggingFace]: 'huggingface',
  [ProviderTypeEnum.KimiCoding]: 'kimi-coding',
  [ProviderTypeEnum.MiniMax]: 'minimax',
  [ProviderTypeEnum.MiniMaxCN]: 'minimax-cn',
  [ProviderTypeEnum.MoonshotAI]: 'moonshotai',
  [ProviderTypeEnum.MoonshotAICN]: 'moonshotai-cn',
  [ProviderTypeEnum.Xiaomi]: 'xiaomi',
  [ProviderTypeEnum.XiaomiTokenPlanAMS]: 'xiaomi-token-plan-ams',
  [ProviderTypeEnum.XiaomiTokenPlanCN]: 'xiaomi-token-plan-cn',
  [ProviderTypeEnum.XiaomiTokenPlanSGP]: 'xiaomi-token-plan-sgp',
};

function getProviderModels(providerId: string, config: ProviderConfig): string[] {
  if (config.type === ProviderTypeEnum.AzureOpenAI) {
    return config.azureDeploymentNames || [];
  }
  if (config.type === ProviderTypeEnum.CustomOpenAI) {
    return config.modelNames || [];
  }
  const piProvider = providerToPiProvider[config.type as ProviderTypeEnum];
  return piProvider ? [...piModelRegistry[piProvider]] : config.modelNames || [];
}

export default function ModelSelector({ onModelConfigured }: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedValue, setSelectedValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState('');

  const modelOptions = useMemo<ModelOption[]>(
    () =>
      providers.flatMap(provider =>
        getProviderModels(provider.id, provider.config).map(model => ({
          providerId: provider.id,
          providerName: provider.name,
          providerType: provider.config.type || provider.id,
          model,
        })),
      ),
    [providers],
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return modelOptions;
    return modelOptions.filter(option =>
      `${option.providerName} ${option.model}`.toLowerCase().includes(normalizedQuery),
    );
  }, [modelOptions, query]);

  const loadOptions = useCallback(async () => {
    const [providerRecord, navigatorModel] = await Promise.all([
      llmProviderStore.getAllProviders(),
      agentModelStore.getAgentModel(AgentNameEnum.MinAgent),
    ]);

    const providerOptions = Object.entries(providerRecord).map(([id, config]) => ({
      id,
      name: getDefaultDisplayNameFromProviderId(config.type || id),
      config,
    }));

    setProviders(providerOptions);

    const initialProviderId = navigatorModel?.provider || providerOptions[0]?.id || '';
    const initialProvider = providerOptions.find(provider => provider.id === initialProviderId);
    const initialModels = initialProvider ? getProviderModels(initialProvider.id, initialProvider.config) : [];
    const initialModel = navigatorModel?.modelName || initialModels[0] || '';

    setSelectedValue(initialProviderId && initialModel ? `${initialProviderId}>${initialModel}` : '');
  }, []);

  useEffect(() => {
    loadOptions().catch(error => console.error('Failed to load model selector options:', error));
  }, [loadOptions]);

  const saveModel = async (option: ModelOption) => {
    if (!option.providerId || !option.model) return;

    setIsSaving(true);
    try {
      await agentModelStore.setAgentModel(AgentNameEnum.MinAgent, {
        provider: option.providerId,
        modelName: option.model,
        parameters: getDefaultAgentModelParams(option.providerType, AgentNameEnum.MinAgent),
      });
      setSelectedValue(`${option.providerId}>${option.model}`);
      onModelConfigured?.();
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedOption = modelOptions.find(option => `${option.providerId}>${option.model}` === selectedValue);
  const currentLabel = selectedOption?.model || 'Select model';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(value => !value)}
        className="flex max-w-[220px] cursor-pointer items-center gap-2 rounded-full border border-bma-border bg-bma-surface px-3 py-1.5 text-sm text-bma-text transition-colors hover:bg-bma-elevated"
        title={currentLabel}>
        <span className="size-1.5 rounded-full bg-bma-accent" />
        <span className="truncate">{currentLabel}</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-30 mb-3 w-[340px] overflow-hidden rounded-2xl border border-bma-border bg-bma-bg-soft text-bma-text shadow-2xl shadow-black/60">
          <div className="border-b border-bma-border p-3">
            <label
              className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-bma-muted"
              htmlFor="model-search">
              Models
            </label>
            <input
              id="model-search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search configured models"
              className="w-full rounded-xl border border-bma-border bg-bma-surface px-3 py-2 text-sm text-bma-text outline-none transition-colors placeholder:text-bma-muted"
            />
          </div>

          <div className="p-2">
            <div className="flex items-center justify-between px-2 pb-2 pt-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-bma-muted">
                Configured providers
              </span>
              <span className="max-w-[180px] truncate text-xs text-bma-muted">{modelOptions.length} models</span>
            </div>
            <div className="max-h-64 overflow-y-auto pr-1">
              {filteredModels.length === 0 ? (
                <div className="rounded-xl border border-bma-border bg-bma-surface px-3 py-5 text-center text-sm text-bma-muted">
                  Configure a provider in settings first.
                </div>
              ) : (
                filteredModels.map(option => {
                  const value = `${option.providerId}>${option.model}`;
                  const isSelected = value === selectedValue;
                  return (
                    <button
                      key={value}
                      type="button"
                      disabled={isSaving}
                      onClick={() => saveModel(option)}
                      className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-bma-accent text-bma-accentText'
                          : 'text-bma-subtle hover:bg-bma-surface hover:text-bma-text'
                      } disabled:cursor-wait disabled:opacity-60`}>
                      <span className="min-w-0">
                        <span className="block truncate">{option.model}</span>
                        <span
                          className={`block truncate text-xs ${isSelected ? 'text-teal-950/70' : 'text-bma-muted'}`}>
                          {option.providerName}
                        </span>
                      </span>
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
