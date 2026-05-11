// Agent name, used to identify the agent in the settings
export enum AgentNameEnum {
  MinAgent = 'min-agent',
}

// Provider type, types before CustomOpenAI are built-in providers, CustomOpenAI is a custom provider
// For built-in providers, we will create ChatModel instances with its respective LangChain ChatModel classes
// For custom providers, we will create ChatModel instances with the ChatOpenAI class
export enum ProviderTypeEnum {
  OpenAI = 'openai',
  Anthropic = 'anthropic',
  DeepSeek = 'deepseek',
  Gemini = 'gemini',
  Grok = 'grok',
  Ollama = 'ollama',
  AzureOpenAI = 'azure_openai',
  OpenRouter = 'openrouter',
  Groq = 'groq',
  Cerebras = 'cerebras',
  Llama = 'llama',
  Fireworks = 'fireworks',
  Together = 'together',
  Mistral = 'mistral',
  Nebius = 'nebius',
  Xai = 'xai',
  Zai = 'zai',
  BigModel = 'bigmodel',
  Aliyun = 'aliyun',
  Cohere = 'cohere',
  OllamaCloud = 'ollama_cloud',
  GithubCopilot = 'github_copilot',
  CustomOpenAI = 'custom_openai',
}

// Default supported models for each built-in provider
export const llmProviderModelNames = {
  [ProviderTypeEnum.OpenAI]: [
    'gpt-5.1',
    'gpt-5',
    'gpt-5-pro',
    'gpt-5-mini',
    'gpt-5-chat-latest',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4o',
  ],
  [ProviderTypeEnum.Anthropic]: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
  [ProviderTypeEnum.DeepSeek]: ['deepseek-chat', 'deepseek-reasoner'],
  [ProviderTypeEnum.Gemini]: ['gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'],
  [ProviderTypeEnum.Grok]: ['grok-4', 'grok-4-fast-non-reasoning', 'grok-3', 'grok-3-fast'],
  [ProviderTypeEnum.Ollama]: ['qwen3:14b', 'falcon3:10b', 'qwen2.5-coder:14b', 'mistral-small:24b'],
  [ProviderTypeEnum.AzureOpenAI]: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'],
  [ProviderTypeEnum.OpenRouter]: ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-4o-2024-11-20'],
  [ProviderTypeEnum.Groq]: ['llama-3.3-70b-versatile'],
  [ProviderTypeEnum.Cerebras]: ['llama-3.3-70b'],
  [ProviderTypeEnum.Llama]: [
    'Llama-3.3-70B-Instruct',
    'Llama-3.3-8B-Instruct',
    'Llama-4-Maverick-17B-128E-Instruct-FP8',
    'Llama-4-Scout-17B-16E-Instruct-FP8',
  ],
  [ProviderTypeEnum.Fireworks]: [
    'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
    'accounts/fireworks/models/kimi-k2-instruct',
  ],
  [ProviderTypeEnum.Together]: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8'],
  [ProviderTypeEnum.Mistral]: ['mistral-large-latest', 'codestral-latest', 'ministral-8b-latest'],
  [ProviderTypeEnum.Nebius]: ['Qwen/Qwen3-235B-A22B', 'deepseek-ai/DeepSeek-V3.1'],
  [ProviderTypeEnum.Xai]: ['grok-4', 'grok-3', 'grok-3-mini'],
  [ProviderTypeEnum.Zai]: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
  [ProviderTypeEnum.BigModel]: ['glm-4.6', 'glm-4.5'],
  [ProviderTypeEnum.Aliyun]: ['qwen-max-latest', 'qwen-plus-latest', 'qwen3-coder-plus'],
  [ProviderTypeEnum.Cohere]: ['command-a-03-2025', 'command-r-plus-08-2024'],
  [ProviderTypeEnum.OllamaCloud]: ['gpt-oss:120b', 'qwen3-coder:480b'],
  [ProviderTypeEnum.GithubCopilot]: ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4-5', 'google/gemini-2.5-pro'],
  // Custom OpenAI providers don't have predefined models as they are user-defined
};

// Default parameters for each agent per provider, for providers not specified, use OpenAI parameters
type DefaultModelParameters = Record<string, number> & {
  temperature: number;
  topP: number;
};

export const llmProviderParameters: Partial<
  Record<ProviderTypeEnum, Partial<Record<AgentNameEnum, DefaultModelParameters>>>
> = {
  [ProviderTypeEnum.OpenAI]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Anthropic]: { [AgentNameEnum.MinAgent]: { temperature: 0.2, topP: 0.5 } },
  [ProviderTypeEnum.Gemini]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Grok]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Ollama]: { [AgentNameEnum.MinAgent]: { temperature: 0.1, topP: 0.85 } },
  [ProviderTypeEnum.AzureOpenAI]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.OpenRouter]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Groq]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Cerebras]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Llama]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Fireworks]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Together]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Mistral]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Nebius]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Xai]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Zai]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.BigModel]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Aliyun]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.Cohere]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.OllamaCloud]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
  [ProviderTypeEnum.GithubCopilot]: { [AgentNameEnum.MinAgent]: { temperature: 0.3, topP: 0.85 } },
};
