import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import {
  getModel,
  getModels,
  streamSimple,
  type Model,
  type Api,
  type KnownProvider,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { ProviderConfig, ModelConfig } from '@extension/storage';
import { getProviderTypeByProviderId, ProviderTypeEnum } from '@extension/storage';
import { createLogger } from '@src/background/log';
import { createBrowserTools, type PiToolContext } from './tools';
import type BrowserContext from '../../browser/context';
import { AgentContext, DEFAULT_AGENT_OPTIONS, type AgentOptions } from '../types';
import { EventManager } from '../event/manager';
import { ExecutionState, Actors } from '../event/types';
import { NavigatorPrompt } from '../prompts/navigator';
import MessageManager from '../messages/service';

const logger = createLogger('PiSession');

type PiApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'azure-openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'google-vertex'
  | 'bedrock-converse-stream';

interface PiProviderMapping {
  provider: string;
  api: PiApi;
  requiresBaseUrl?: boolean;
  appendV1BasePath?: boolean;
}

function mapProviderToPi(providerId: string, providerConfig: ProviderConfig): PiProviderMapping {
  const provider = providerConfig.type ?? getProviderTypeByProviderId(providerId);

  switch (provider) {
    case ProviderTypeEnum.OpenAI:
      return { provider: 'openai', api: 'openai-responses' };
    case ProviderTypeEnum.Anthropic:
      return { provider: 'anthropic', api: 'anthropic-messages' };
    case ProviderTypeEnum.DeepSeek:
      return { provider: 'deepseek', api: 'openai-completions' };
    case ProviderTypeEnum.Gemini:
      return { provider: 'google', api: 'google-generative-ai' };
    case ProviderTypeEnum.Grok:
    case ProviderTypeEnum.Xai:
      return { provider: 'xai', api: 'openai-completions' };
    case ProviderTypeEnum.Groq:
      return { provider: 'groq', api: 'openai-completions' };
    case ProviderTypeEnum.Cerebras:
      return { provider: 'cerebras', api: 'openai-completions' };
    case ProviderTypeEnum.Ollama:
      return { provider: 'ollama', api: 'openai-completions', requiresBaseUrl: true, appendV1BasePath: true };
    case ProviderTypeEnum.OpenRouter:
      return { provider: 'openrouter', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Llama:
      return { provider: 'llama', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.AzureOpenAI:
      return { provider: 'azure-openai-responses', api: 'azure-openai-responses', requiresBaseUrl: true };
    case ProviderTypeEnum.AmazonBedrock:
      return { provider: 'amazon-bedrock', api: 'bedrock-converse-stream' };
    case ProviderTypeEnum.CloudflareWorkersAI:
      return { provider: 'cloudflare-workers-ai', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.CloudflareAIGateway:
      return { provider: 'cloudflare-ai-gateway', api: 'anthropic-messages', requiresBaseUrl: true };
    case ProviderTypeEnum.GoogleVertex:
      return { provider: 'google-vertex', api: 'google-vertex', requiresBaseUrl: true };
    case ProviderTypeEnum.VercelAIGateway:
      return { provider: 'vercel-ai-gateway', api: 'anthropic-messages', requiresBaseUrl: true };
    case ProviderTypeEnum.OpenAICodex:
      return { provider: 'openai-codex', api: 'openai-codex-responses', requiresBaseUrl: true };
    case ProviderTypeEnum.OpenCode:
      return { provider: 'opencode', api: 'openai-responses' };
    case ProviderTypeEnum.OpenCodeGo:
      return { provider: 'opencode-go', api: 'openai-completions' };
    case ProviderTypeEnum.HuggingFace:
      return { provider: 'huggingface', api: 'openai-completions' };
    case ProviderTypeEnum.KimiCoding:
      return { provider: 'kimi-coding', api: 'openai-completions' };
    case ProviderTypeEnum.MiniMax:
      return { provider: 'minimax', api: 'openai-completions' };
    case ProviderTypeEnum.MiniMaxCN:
      return { provider: 'minimax-cn', api: 'openai-completions' };
    case ProviderTypeEnum.MoonshotAI:
      return { provider: 'moonshotai', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.MoonshotAICN:
      return { provider: 'moonshotai-cn', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Xiaomi:
      return { provider: 'xiaomi', api: 'anthropic-messages', requiresBaseUrl: true };
    case ProviderTypeEnum.XiaomiTokenPlanAMS:
      return { provider: 'xiaomi-token-plan-ams', api: 'anthropic-messages', requiresBaseUrl: true };
    case ProviderTypeEnum.XiaomiTokenPlanCN:
      return { provider: 'xiaomi-token-plan-cn', api: 'anthropic-messages', requiresBaseUrl: true };
    case ProviderTypeEnum.XiaomiTokenPlanSGP:
      return { provider: 'xiaomi-token-plan-sgp', api: 'anthropic-messages', requiresBaseUrl: true };
    case ProviderTypeEnum.Fireworks:
      return { provider: 'fireworks', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Together:
      return { provider: 'together', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Mistral:
      return { provider: 'mistral', api: 'openai-completions' };
    case ProviderTypeEnum.Nebius:
      return { provider: 'nebius', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Zai:
    case ProviderTypeEnum.BigModel:
      return { provider: 'zai', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Aliyun:
      return { provider: 'aliyun', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.Cohere:
      return { provider: 'cohere', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.OllamaCloud:
      return { provider: 'ollama', api: 'openai-completions', requiresBaseUrl: true, appendV1BasePath: true };
    case ProviderTypeEnum.GithubCopilot:
      return { provider: 'github-copilot', api: 'openai-completions', requiresBaseUrl: true };
    case ProviderTypeEnum.CustomOpenAI:
      return {
        provider: providerConfig.name?.trim() || providerId,
        api: 'openai-completions',
        requiresBaseUrl: true,
      };
    default:
      throw new Error(`Provider ${provider} is not supported by the Pi integration`);
  }
}

function normalizeBaseUrl(baseUrl: string | undefined, mapping: PiProviderMapping): string {
  const trimmed = baseUrl?.trim() || '';
  if (mapping.requiresBaseUrl && !trimmed) {
    throw new Error(`Provider ${mapping.provider} requires a base URL for Pi`);
  }
  if (!trimmed || !mapping.appendV1BasePath) {
    return trimmed;
  }
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed.replace(/\/+$/, '')}/v1`;
}

function withProviderOverrides(
  model: Model<Api>,
  providerConfig: ProviderConfig,
  mapping: PiProviderMapping,
): Model<Api> {
  return {
    ...model,
    provider: mapping.provider,
    baseUrl: normalizeBaseUrl(providerConfig.baseUrl || model.baseUrl, mapping),
  };
}

function getDefaultProviderBaseUrl(provider: string): string {
  const models = getModels(provider as KnownProvider) as Model<Api>[];
  return models[0]?.baseUrl || '';
}

function createPiModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): Model<Api> | undefined {
  const mapping = mapProviderToPi(modelConfig.provider, providerConfig);
  const piProvider = mapping.provider;
  const piModelId = modelConfig.modelName;

  const builtInModel = (getModel as (provider: KnownProvider, modelId: string) => Model<Api> | undefined)(
    piProvider as KnownProvider,
    piModelId,
  );
  if (builtInModel) {
    return withProviderOverrides(builtInModel as Model<Api>, providerConfig, mapping);
  }

  logger.info(`Creating custom Pi model for ${piProvider}/${piModelId}`);

  const defaultBaseUrl = getDefaultProviderBaseUrl(piProvider);

  return {
    id: piModelId,
    name: piModelId,
    api: mapping.api,
    provider: piProvider,
    baseUrl: normalizeBaseUrl(providerConfig.baseUrl || defaultBaseUrl, mapping),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

export interface PiSessionOptions {
  task: string;
  taskId: string;
  browserContext: BrowserContext;
  providerConfig: ProviderConfig;
  modelConfig: ModelConfig;
  agentOptions?: Partial<AgentOptions>;
}

export interface PiSession {
  agent: Agent;
  context: AgentContext;
  eventManager: EventManager;
}

function createPiStreamOptions(providerConfig: ProviderConfig, modelConfig: ModelConfig): Partial<SimpleStreamOptions> {
  const parameters = modelConfig.parameters || {};
  const temperature = parameters.temperature;
  const maxTokens = parameters.maxTokens;
  const options: Partial<SimpleStreamOptions> = {};

  if (typeof temperature === 'number') {
    options.temperature = temperature;
  }
  if (typeof maxTokens === 'number') {
    options.maxTokens = maxTokens;
  }

  return {
    ...options,
    ...(providerConfig.type === ProviderTypeEnum.AzureOpenAI
      ? {
          azureApiVersion: providerConfig.azureApiVersion,
          azureBaseUrl: providerConfig.baseUrl,
          azureDeploymentName: modelConfig.modelName,
        }
      : {}),
  } as Partial<SimpleStreamOptions>;
}

async function waitIfPaused(context: AgentContext, signal?: AbortSignal): Promise<void> {
  while (context.paused && !context.stopped && !signal?.aborted) {
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

function isUnderspecifiedTypingTask(task: string): boolean {
  const normalized = task.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!/^(type|enter|write|fill)\b/.test(normalized)) return false;
  if (/["'`].+["'`]/.test(task)) return false;
  if (/\b(type|enter|write|fill)\s+.+\s+(in|into|inside|on)\b/i.test(task)) return false;
  return /\b(in|into|inside|on)?\s*(the\s+)?(ide|editor|input|field|box|thing|page)\b/.test(normalized);
}

export async function createPiAgent(options: PiSessionOptions): Promise<PiSession> {
  const { task, taskId, browserContext, providerConfig, modelConfig, agentOptions } = options;

  const model = createPiModel(providerConfig, modelConfig);
  if (!model) {
    throw new Error(`Could not create Pi model for ${modelConfig.provider}/${modelConfig.modelName}`);
  }

  const eventManager = new EventManager();
  const messageManager = new MessageManager();

  const context = new AgentContext(taskId, browserContext, messageManager, eventManager, agentOptions || {});

  const navigatorPrompt = new NavigatorPrompt(
    agentOptions?.maxActionsPerStep ?? DEFAULT_AGENT_OPTIONS.maxActionsPerStep,
  );
  const systemPrompt = navigatorPrompt.getSystemMessage().content as string;

  const useVision = agentOptions?.useVision ?? DEFAULT_AGENT_OPTIONS.useVision;
  const piStreamOptions = createPiStreamOptions(providerConfig, modelConfig);
  const thinkingLevel = modelConfig.reasoningEffort ?? 'medium';
  let finalSuccess = true;
  let terminalFailure: string | null = null;
  const underspecifiedTypingTask = isUnderspecifiedTypingTask(task);

  // Create tools bound to the runtime context
  const toolCtx: PiToolContext = {
    agentContext: context,
    onDone: (text, success) => {
      context.finalAnswer = text;
      finalSuccess = success;
    },
  };
  const tools = createBrowserTools(toolCtx);

  // Create the Pi Agent
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel,
      tools,
    },
    getApiKey: () => providerConfig.apiKey,
    streamFn: (streamModel, streamContext, streamOptions) =>
      streamSimple(streamModel, streamContext, {
        ...streamOptions,
        ...piStreamOptions,
      } as SimpleStreamOptions),
    toolExecution: 'sequential',
    beforeToolCall: async ({ toolCall }, signal) => {
      await waitIfPaused(context, signal);
      if (context.stopped || signal?.aborted) {
        return { block: true, reason: 'Task cancelled' };
      }
      if (underspecifiedTypingTask && toolCall.name !== 'done') {
        return {
          block: true,
          reason: 'The user asked to type into a page, but did not provide the exact text. Ask the user what to type.',
        };
      }

      return undefined;
    },
  });

  // Forward Pi agent events to the extension's EventManager
  let lastThinking = '';
  let lastText = '';
  void lastThinking;
  void lastText;

  agent.subscribe(async event => {
    switch (event.type) {
      case 'agent_start':
        await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_START, task);
        break;

      case 'agent_end': {
        if (terminalFailure) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_FAIL, terminalFailure);
          break;
        }
        if (context.stopped) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_CANCEL, 'Task cancelled');
          break;
        }
        const lastMsg = event.messages[event.messages.length - 1];
        const assistantError = extractAssistantError(lastMsg);
        if (assistantError) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_FAIL, assistantError);
          break;
        }
        const finalAnswer = context.finalAnswer;
        if (finalAnswer && finalSuccess) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_OK, finalAnswer);
        } else if (finalAnswer) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_FAIL, finalAnswer);
        } else {
          // Extract final text from last assistant message
          const text = extractTextFromMessage(lastMsg);
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_OK, text || 'Task completed');
        }
        break;
      }

      case 'turn_start':
        context.nSteps += 1;
        await context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.STEP_START,
          `Step ${context.nSteps}/${context.options.maxSteps}`,
        );
        if (context.nSteps > context.options.maxSteps) {
          terminalFailure = `Max steps reached (${context.options.maxSteps})`;
          agent.abort();
        }
        break;

      case 'turn_end':
        await context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Turn completed');
        break;

      case 'message_update': {
        const ame = event.assistantMessageEvent;
        if (ame.type === 'thinking_delta') {
          lastThinking += ame.delta;
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.STREAM_THINKING, ame.delta);
        } else if (ame.type === 'text_delta') {
          lastText += ame.delta;
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.STREAM_TEXT, ame.delta);
        }
        break;
      }

      case 'tool_execution_start': {
        await context.emitEvent(
          Actors.NAVIGATOR,
          ExecutionState.ACT_START,
          `${event.toolName}: ${JSON.stringify({ toolCallId: event.toolCallId, input: event.args })}`,
        );
        break;
      }

      case 'tool_execution_end': {
        if (event.isError) {
          context.consecutiveFailures += 1;
          await context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_FAIL,
            `${event.toolName}: ${JSON.stringify({
              toolCallId: event.toolCallId,
              error: extractToolResultText(event.result) || `${event.toolName} failed`,
            })}`,
          );
          if (context.consecutiveFailures >= context.options.maxFailures) {
            terminalFailure = `Max failures reached (${context.options.maxFailures})`;
            agent.abort();
          }
        } else {
          context.consecutiveFailures = 0;
          await context.emitEvent(
            Actors.NAVIGATOR,
            ExecutionState.ACT_OK,
            `${event.toolName}: ${JSON.stringify({
              toolCallId: event.toolCallId,
              result: extractToolResultText(event.result) || 'completed',
            })}`,
          );
        }
        break;
      }

      case 'message_start':
      case 'message_end':
        // Reset streaming accumulators
        if (event.type === 'message_start') {
          lastThinking = '';
          lastText = '';
        }
        break;
    }
  });

  // Inject browser state before each LLM call via transformContext
  agent.transformContext = async (messages, signal) => {
    if (signal?.aborted) return messages;

    try {
      // Enable element-change tracking so isNew markers are computed
      const browserState = await browserContext.getState(useVision, true);
      const elementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);
      const tabsInfo = browserState.tabs.map(tab => `Tab ${tab.id}: ${tab.url}`).join('\n');

      // Surface recent tool results prominently so the model cannot miss what it already did
      const recentActions = messages
        .filter((m): m is AgentMessage & { role: 'toolResult'; toolName: string; isError: boolean; content: Array<{ type: string; text?: string }> } => {
          if (m.role !== 'toolResult') return false;
          const record = m as unknown as Record<string, unknown>;
          const content = Array.isArray(record.content) ? record.content : [];
          return content.some((c: unknown) => {
            const item = c as Record<string, unknown>;
            return c && typeof c === 'object' && item.type === 'text';
          });
        })
        .slice(-10)
        .map(m => {
          const text = m.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
            .map(c => c.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          const shortText = text.length > 200 ? text.slice(0, 200) + '...' : text;
          return `- ${m.toolName}${m.isError ? ' (error)' : ''}: ${shortText}`;
        })
        .join('\n');

      const recentActionsSection = recentActions.length > 0
        ? `\n\nRecent actions (do not repeat):\n${recentActions}`
        : '';

      const stateMessage = {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: `Current browser state:\n\nURL: ${browserState.url}\nTitle: ${browserState.title}\n\nTabs:\n${tabsInfo}${recentActionsSection}\n\nInteractive elements:\n${elementsText}`,
          },
        ],
        timestamp: Date.now(),
      };

      // Remove previous ephemeral browser state messages
      const filteredMessages = messages.filter((m: AgentMessage) => {
        if (m.role !== 'user') return true;
        const content = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
        return !content.some(c => c.type === 'text' && c.text?.startsWith('Current browser state:'));
      });

      return [...filteredMessages, stateMessage];
    } catch (error) {
      logger.error('Failed to get browser state for transformContext:', error);
      return messages;
    }
  };

  return { agent, context, eventManager };
}

function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item => {
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractTextFromMessage(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as Record<string, unknown>;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((c: unknown) => (c as Record<string, unknown>)?.type === 'text')
      .map((c: unknown) => (c as Record<string, unknown>).text as string)
      .join('');
  }
  if (typeof m.content === 'string') {
    return m.content;
  }
  return '';
}

function extractAssistantError(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as Record<string, unknown>;
  if (m.role !== 'assistant') return '';
  if (m.stopReason === 'error' || m.stopReason === 'aborted') {
    return typeof m.errorMessage === 'string' && m.errorMessage.length > 0
      ? m.errorMessage
      : `Assistant stopped with reason: ${String(m.stopReason)}`;
  }
  return '';
}
