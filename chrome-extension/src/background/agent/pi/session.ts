import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import { getModel, type Model, type Api, type KnownProvider } from '@earendil-works/pi-ai';
import type { ProviderConfig, ModelConfig } from '@extension/storage';
import { ProviderTypeEnum } from '@extension/storage';
import { createLogger } from '@src/background/log';
import { createBrowserTools, type PiToolContext } from './tools';
import type BrowserContext from '../../browser/context';
import { AgentContext, DEFAULT_AGENT_OPTIONS, type AgentOptions } from '../types';
import { EventManager } from '../event/manager';
import { ExecutionState, Actors } from '../event/types';
import { NavigatorPrompt } from '../prompts/navigator';
import MessageManager from '../messages/service';

const logger = createLogger('PiSession');

function mapProviderToPi(provider: ProviderTypeEnum): string {
  switch (provider) {
    case ProviderTypeEnum.OpenAI:
      return 'openai';
    case ProviderTypeEnum.Anthropic:
      return 'anthropic';
    case ProviderTypeEnum.DeepSeek:
      return 'deepseek';
    case ProviderTypeEnum.Gemini:
      return 'google';
    case ProviderTypeEnum.Grok:
      return 'xai';
    case ProviderTypeEnum.Groq:
      return 'groq';
    case ProviderTypeEnum.Cerebras:
      return 'cerebras';
    case ProviderTypeEnum.Ollama:
      return 'ollama';
    case ProviderTypeEnum.OpenRouter:
      return 'openrouter';
    case ProviderTypeEnum.Llama:
      return 'openai';
    case ProviderTypeEnum.AzureOpenAI:
      return 'azure-openai-responses';
    default:
      return provider;
  }
}

function createPiModel(providerConfig: ProviderConfig, modelConfig: ModelConfig): Model<Api> | undefined {
  const piProvider = mapProviderToPi(modelConfig.provider as ProviderTypeEnum);
  const piModelId = modelConfig.modelName;

  const builtInModel = (getModel as (provider: KnownProvider, modelId: string) => Model<Api> | undefined)(
    piProvider as KnownProvider,
    piModelId,
  );
  if (builtInModel) {
    return builtInModel as Model<Api>;
  }

  logger.info(`Creating custom Pi model for ${piProvider}/${piModelId}`);

  let api: Model<Api>['api'] = 'openai-completions';
  switch (modelConfig.provider) {
    case ProviderTypeEnum.Anthropic:
      api = 'anthropic-messages';
      break;
    case ProviderTypeEnum.Gemini:
      api = 'google-generative-ai';
      break;
    case ProviderTypeEnum.AzureOpenAI:
      api = 'azure-openai-responses';
      break;
    case ProviderTypeEnum.Ollama:
      api = 'openai-completions';
      break;
    default:
      api = 'openai-completions';
  }

  return {
    id: piModelId,
    name: piModelId,
    api,
    provider: piProvider,
    baseUrl: providerConfig.baseUrl || '',
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

  // Create tools bound to the runtime context
  const toolCtx: PiToolContext = {
    agentContext: context,
    onDone: text => {
      context.finalAnswer = text;
    },
  };
  const tools = createBrowserTools(toolCtx);

  // Create the Pi Agent
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: 'medium',
      tools,
    },
    getApiKey: () => providerConfig.apiKey,
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
        const finalAnswer = context.finalAnswer;
        if (finalAnswer) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_OK, finalAnswer);
        } else {
          // Extract final text from last assistant message
          const lastMsg = event.messages[event.messages.length - 1];
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
          `${event.toolName}: ${JSON.stringify(event.args)}`,
        );
        break;
      }

      case 'tool_execution_end': {
        if (event.isError) {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, `${event.toolName} failed`);
        } else {
          await context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, `${event.toolName} completed`);
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
      const browserState = await browserContext.getState(useVision);
      const elementsText = browserState.elementTree.clickableElementsToString(DEFAULT_AGENT_OPTIONS.includeAttributes);
      const tabsInfo = browserState.tabs.map(tab => `Tab ${tab.id}: ${tab.url}`).join('\n');

      const stateMessage = {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: `Current browser state:\n\nURL: ${browserState.url}\nTitle: ${browserState.title}\n\nTabs:\n${tabsInfo}\n\nInteractive elements:\n${elementsText}`,
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
