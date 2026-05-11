import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ProviderTypeEnum,
  getDefaultDisplayNameFromProviderId,
  getDefaultProviderConfig,
  llmProviderStore,
  piModelRegistry,
  type PiRegistryProvider,
  type ProviderConfig,
} from '@extension/storage';
import { FiCheck, FiCpu, FiEye, FiEyeOff, FiSearch, FiSliders } from 'react-icons/fi';

interface ModelSettingsProps {
  isDarkMode?: boolean;
}

type ModelOption = {
  provider: string;
  providerName: string;
  model: string;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const providerGroups: Array<{ label: string; providers: ProviderTypeEnum[] }> = [
  {
    label: 'Direct APIs',
    providers: [
      ProviderTypeEnum.OpenAI,
      ProviderTypeEnum.Anthropic,
      ProviderTypeEnum.Gemini,
      ProviderTypeEnum.DeepSeek,
      ProviderTypeEnum.Grok,
      ProviderTypeEnum.Xai,
      ProviderTypeEnum.Groq,
      ProviderTypeEnum.Cerebras,
      ProviderTypeEnum.Mistral,
      ProviderTypeEnum.Zai,
    ],
  },
  {
    label: 'Routers and gateways',
    providers: [
      ProviderTypeEnum.OpenRouter,
      ProviderTypeEnum.VercelAIGateway,
      ProviderTypeEnum.CloudflareWorkersAI,
      ProviderTypeEnum.CloudflareAIGateway,
      ProviderTypeEnum.HuggingFace,
    ],
  },
  {
    label: 'Cloud and platform',
    providers: [
      ProviderTypeEnum.AzureOpenAI,
      ProviderTypeEnum.AmazonBedrock,
      ProviderTypeEnum.GoogleVertex,
      ProviderTypeEnum.Fireworks,
      ProviderTypeEnum.Together,
      ProviderTypeEnum.Nebius,
      ProviderTypeEnum.Llama,
      ProviderTypeEnum.GithubCopilot,
      ProviderTypeEnum.OpenAICodex,
      ProviderTypeEnum.OpenCode,
      ProviderTypeEnum.OpenCodeGo,
    ],
  },
  {
    label: 'Regional and local',
    providers: [
      ProviderTypeEnum.Ollama,
      ProviderTypeEnum.OllamaCloud,
      ProviderTypeEnum.KimiCoding,
      ProviderTypeEnum.MiniMax,
      ProviderTypeEnum.MiniMaxCN,
      ProviderTypeEnum.MoonshotAI,
      ProviderTypeEnum.MoonshotAICN,
      ProviderTypeEnum.BigModel,
      ProviderTypeEnum.Aliyun,
      ProviderTypeEnum.Cohere,
      ProviderTypeEnum.Xiaomi,
      ProviderTypeEnum.XiaomiTokenPlanAMS,
      ProviderTypeEnum.XiaomiTokenPlanCN,
      ProviderTypeEnum.XiaomiTokenPlanSGP,
    ],
  },
];

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

function supportsBaseUrl(config: ProviderConfig): boolean {
  return Boolean(config.baseUrl !== undefined || config.type === ProviderTypeEnum.CustomOpenAI);
}

function providerRequiresKey(config: ProviderConfig): boolean {
  return ![
    ProviderTypeEnum.Ollama,
    ProviderTypeEnum.CustomOpenAI,
    ProviderTypeEnum.AmazonBedrock,
    ProviderTypeEnum.GoogleVertex,
  ].includes(config.type as ProviderTypeEnum);
}

function isConfigured(config?: ProviderConfig): boolean {
  if (!config) return false;
  if (config.type === ProviderTypeEnum.AzureOpenAI) {
    return Boolean(
      config.apiKey.trim() &&
        config.baseUrl?.trim() &&
        config.azureApiVersion?.trim() &&
        config.azureDeploymentNames?.length,
    );
  }
  if (config.type === ProviderTypeEnum.CustomOpenAI) {
    return Boolean(config.baseUrl?.trim());
  }
  if (!providerRequiresKey(config)) {
    return Boolean(config.apiKey.trim() || config.baseUrl?.trim());
  }
  return Boolean(config.apiKey.trim());
}

function makeProviderId(type: ProviderTypeEnum, existing: Record<string, ProviderConfig>): string {
  if (type === ProviderTypeEnum.AzureOpenAI) {
    const count = Object.keys(existing).filter(
      key => key === ProviderTypeEnum.AzureOpenAI || key.startsWith(`${ProviderTypeEnum.AzureOpenAI}_`),
    ).length;
    return count === 0 ? ProviderTypeEnum.AzureOpenAI : `${ProviderTypeEnum.AzureOpenAI}_${count + 1}`;
  }
  return type;
}

function getModelIds(providerId: string, config: ProviderConfig): string[] {
  if (config.type === ProviderTypeEnum.AzureOpenAI) {
    return config.azureDeploymentNames || [];
  }
  if (config.type === ProviderTypeEnum.CustomOpenAI) {
    return config.modelNames || [];
  }
  const piProvider = providerToPiProvider[config.type as ProviderTypeEnum];
  if (!piProvider) return config.modelNames || [];
  return [...piModelRegistry[piProvider]];
}

function uniqueOptions(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return options.filter(option => {
    const key = `${option.provider}>${option.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const ModelSettings = (_props: ModelSettingsProps) => {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [selectedProviderId, setSelectedProviderId] = useState<string>(ProviderTypeEnum.OpenAI);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [status, setStatus] = useState('');
  const autoSaveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const load = async () => {
      const allProviders = await llmProviderStore.getAllProviders();
      setProviders(allProviders);
      setSelectedProviderId(Object.keys(allProviders)[0] || ProviderTypeEnum.OpenAI);
    };

    load().catch(error => {
      console.error('Failed to load model settings:', error);
      setStatus('Failed to load settings.');
    });
  }, []);

  const selectedProvider = providers[selectedProviderId] || getDefaultProviderConfig(selectedProviderId);

  const configuredProviders = useMemo(
    () => Object.entries(providers).filter(([, config]) => isConfigured(config)),
    [providers],
  );

  const availableModels = useMemo<ModelOption[]>(() => {
    return uniqueOptions(
      configuredProviders.flatMap(([providerId, config]) =>
        getModelIds(providerId, config).map(model => ({
          provider: providerId,
          providerName: config.name || getDefaultDisplayNameFromProviderId(config.type || providerId),
          model,
        })),
      ),
    );
  }, [configuredProviders]);

  const filteredGroups = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return providerGroups
      .map(group => ({
        ...group,
        providers: group.providers.filter(provider => {
          const label = getDefaultDisplayNameFromProviderId(provider).toLowerCase();
          return !query || label.includes(query) || provider.includes(query);
        }),
      }))
      .filter(group => group.providers.length > 0);
  }, [catalogSearch]);

  const autoSaveProvider = async (providerId: string, config: ProviderConfig) => {
    setSaveState('saving');
    try {
      if (isConfigured(config)) {
        await llmProviderStore.setProvider(providerId, config);
      } else {
        await llmProviderStore.removeProvider(providerId);
      }
      setSaveState('saved');
      setStatus(
        isConfigured(config) ? `${config.name || providerId} saved.` : `${config.name || providerId} not configured.`,
      );
    } catch (error) {
      console.error('Failed to autosave provider:', error);
      setSaveState('error');
      setStatus('Autosave failed. Check required provider fields.');
    }
  };

  const updateProvider = (providerId: string, patch: Partial<ProviderConfig>) => {
    const current = providers[providerId] || getDefaultProviderConfig(providerId);
    const next = {
      ...current,
      ...patch,
    };
    setProviders(prev => ({
      ...prev,
      [providerId]: next,
    }));
    window.clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = window.setTimeout(() => {
      void autoSaveProvider(providerId, next);
    }, 450);
  };

  const selectProvider = (type: ProviderTypeEnum) => {
    const providerId = makeProviderId(type, providers);
    setSelectedProviderId(providerId);
    if (!providers[providerId]) {
      const config = getDefaultProviderConfig(type);
      setProviders(prev => ({
        ...prev,
        [providerId]: config,
      }));
    }
  };

  const configuredCount = configuredProviders.length;

  return (
    <section className="space-y-6 text-left">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Pi providers</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Model settings</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Click any provider to edit its credentials. Providers are detected as configured when required credentials
            are present. Pick the active chat model from the extension sidebar.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2">
          <Metric label="Configured" value={configuredCount.toString()} />
          <Metric label="Models" value={availableModels.length.toString()} />
        </div>
      </div>

      {status && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {status}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-slate-800 bg-black p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-white">Providers</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500">Configured providers are highlighted.</p>
          </div>
          <label className="relative block">
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              value={catalogSearch}
              onChange={event => setCatalogSearch(event.target.value)}
              placeholder="Search providers"
              className="input-control pl-9"
            />
          </label>

          <div className="mt-4 max-h-[720px] space-y-5 overflow-y-auto pr-1">
            {filteredGroups.map(group => (
              <div key={group.label}>
                <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {group.label}
                </h3>
                <div className="space-y-1">
                  {group.providers.map(provider => {
                    const providerId = makeProviderId(provider, providers);
                    const config = providers[providerId] || getDefaultProviderConfig(provider);
                    const configured = isConfigured(config);
                    const selected = selectedProviderId === providerId;
                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => selectProvider(provider)}
                        className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-400 ${
                          selected
                            ? 'bg-white text-slate-950'
                            : configured
                              ? 'bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15'
                              : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                        }`}>
                        <span className="truncate font-medium">{getDefaultDisplayNameFromProviderId(provider)}</span>
                        {configured && (
                          <FiCheck className={`size-4 shrink-0 ${selected ? 'text-slate-950' : 'text-emerald-300'}`} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <Panel
          title="Provider setup"
          subtitle={`${getDefaultDisplayNameFromProviderId(selectedProvider.type || selectedProviderId)} autosaves as you type.`}>
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Selected</p>
                <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-white">
                  <FiCpu className="size-5 text-emerald-300" />
                  {getDefaultDisplayNameFromProviderId(selectedProvider.type || selectedProviderId)}
                </h2>
              </div>
              <SavePill state={saveState} configured={isConfigured(selectedProvider)} />
            </div>

            <Field label={providerRequiresKey(selectedProvider) ? 'API key' : 'API key optional'}>
              <div className="flex gap-2">
                <input
                  value={selectedProvider.apiKey || ''}
                  type={visibleKeys[selectedProviderId] ? 'text' : 'password'}
                  onChange={event => updateProvider(selectedProviderId, { apiKey: event.target.value })}
                  className="input-control"
                />
                <IconButton
                  label={visibleKeys[selectedProviderId] ? 'Hide API key' : 'Show API key'}
                  onClick={() =>
                    setVisibleKeys(prev => ({ ...prev, [selectedProviderId]: !prev[selectedProviderId] }))
                  }>
                  {visibleKeys[selectedProviderId] ? <FiEyeOff className="size-4" /> : <FiEye className="size-4" />}
                </IconButton>
              </div>
            </Field>

            {supportsBaseUrl(selectedProvider) && (
              <Field label={selectedProvider.type === ProviderTypeEnum.AzureOpenAI ? 'Endpoint' : 'Base URL'}>
                <input
                  value={selectedProvider.baseUrl || ''}
                  onChange={event => updateProvider(selectedProviderId, { baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="input-control"
                />
              </Field>
            )}

            {selectedProvider.type === ProviderTypeEnum.AzureOpenAI && (
              <Field label="Azure deployments">
                <textarea
                  value={(selectedProvider.azureDeploymentNames || []).join('\n')}
                  onChange={event =>
                    updateProvider(selectedProviderId, {
                      azureDeploymentNames: event.target.value
                        .split('\n')
                        .map(item => item.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={4}
                  placeholder="One deployment name per line"
                  className="input-control min-h-28 py-2"
                />
              </Field>
            )}

            {selectedProvider.type === ProviderTypeEnum.AzureOpenAI && (
              <Field label="Azure API version">
                <input
                  value={selectedProvider.azureApiVersion || ''}
                  onChange={event => updateProvider(selectedProviderId, { azureApiVersion: event.target.value })}
                  placeholder="2025-04-01-preview"
                  className="input-control"
                />
              </Field>
            )}

            <div className="rounded-md border border-slate-800 bg-slate-950 p-3 text-xs leading-5 text-slate-400">
              Models are read-only and come from the bundled Pi SDK. Select the active model from the extension sidebar.
            </div>
          </div>
        </Panel>
      </div>
    </section>
  );
};

const Panel = ({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) => (
  <section className="rounded-lg border border-slate-800 bg-black p-5 shadow-sm">
    <div className="mb-4">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm leading-5 text-slate-500">{subtitle}</p>
    </div>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block space-y-2">
    <span className="text-sm font-medium text-slate-200">{label}</span>
    {children}
  </label>
);

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-24">
    <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
    <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
  </div>
);

const IconButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-md border border-slate-700 text-slate-300 transition hover:bg-slate-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-500">
    {children}
  </button>
);

const SavePill = ({ state, configured }: { state: SaveState; configured: boolean }) => {
  const label =
    state === 'saving' ? 'Saving' : state === 'error' ? 'Check fields' : configured ? 'Configured' : 'Not configured';
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${
        configured
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : state === 'error'
            ? 'border-red-500/40 bg-red-500/10 text-red-200'
            : 'border-slate-700 bg-slate-950 text-slate-400'
      }`}>
      <FiSliders className="size-3" />
      {label}
    </span>
  );
};
