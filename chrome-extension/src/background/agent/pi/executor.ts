import { createPiAgent } from './session';
import { ExecutionState, EventType, Actors } from '../event/types';
import { createLogger } from '@src/background/log';
import type { EventCallback } from '../event/types';
import { EventManager } from '../event/manager';
import type { ProviderConfig, ModelConfig, GeneralSettingsConfig } from '@extension/storage';
import type BrowserContext from '../../browser/context';
import type { AgentOptions } from '../types';

const logger = createLogger('PiExecutor');

export interface PiExecutorOptions {
  agentOptions?: Partial<AgentOptions>;
  generalSettings?: GeneralSettingsConfig;
}

export class PiExecutor {
  private task: string;
  private taskId: string;
  private browserContext: BrowserContext;
  private providerConfig: ProviderConfig;
  private modelConfig: ModelConfig;
  private options: PiExecutorOptions;

  private session: Awaited<ReturnType<typeof createPiAgent>> | null = null;
  private followUpTasks: string[] = [];
  private eventManager: EventManager = new EventManager();
  private running = false;

  constructor(
    task: string,
    taskId: string,
    browserContext: BrowserContext,
    providerConfig: ProviderConfig,
    modelConfig: ModelConfig,
    options: PiExecutorOptions = {},
  ) {
    this.task = task;
    this.taskId = taskId;
    this.browserContext = browserContext;
    this.providerConfig = providerConfig;
    this.modelConfig = modelConfig;
    this.options = options;
  }

  async execute(): Promise<{ success: boolean; result: string }> {
    if (this.running) {
      throw new Error('Executor is already running');
    }

    this.running = true;

    try {
      this.session = await createPiAgent({
        task: this.task,
        taskId: this.taskId,
        browserContext: this.browserContext,
        providerConfig: this.providerConfig,
        modelConfig: this.modelConfig,
        agentOptions: this.options.agentOptions,
      });

      // Forward events from the session's event manager to our local event manager
      const forwardCallback: EventCallback = async event => {
        await this.eventManager.emit(event);
      };
      this.session.eventManager.subscribe(EventType.EXECUTION, forwardCallback);

      // Execute the task
      await this.session.agent.prompt(this.task);
      await this.session.agent.waitForIdle();

      // Process any follow-up tasks
      while (this.followUpTasks.length > 0 && this.running) {
        const followUp = this.followUpTasks.shift();
        if (followUp) {
          logger.info('Processing follow-up task:', followUp);
          await this.session.agent.prompt(followUp);
          await this.session.agent.waitForIdle();
        }
      }

      const resultText = this.session.context.finalAnswer || 'Task completed';
      return { success: true, result: resultText };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Pi executor error:', errorMessage);
      if (this.session) {
        await this.session.context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_FAIL, errorMessage);
      }
      return { success: false, result: errorMessage };
    } finally {
      this.running = false;
    }
  }

  async cancel(): Promise<void> {
    if (this.session) {
      this.session.agent.abort();
      this.session.context.stopped = true;
      await this.session.context.emitEvent(Actors.NAVIGATOR, ExecutionState.TASK_CANCEL, 'Task cancelled');
    }
    this.followUpTasks = [];
    this.running = false;
  }

  async pause(): Promise<void> {
    if (this.session) {
      await this.session.context.pause();
    }
  }

  async resume(): Promise<void> {
    if (this.session) {
      await this.session.context.resume();
    }
  }

  addFollowUpTask(task: string): void {
    this.followUpTasks.push(task);
  }

  async replayHistory(_historySessionId: string): Promise<{ success: boolean; result: string }> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void _historySessionId;
    // TODO: Implement history replay for Pi agent
    logger.warning('replayHistory is not yet implemented for Pi agent');
    return { success: false, result: 'replayHistory not implemented for Pi agent' };
  }

  async cleanup(): Promise<void> {
    if (this.session) {
      this.session.agent.abort();
    }
    this.session = null;
    this.followUpTasks = [];
    this.running = false;
  }

  clearExecutionEvents(): void {
    this.eventManager.clearSubscribers(EventType.EXECUTION);
  }

  subscribeExecutionEvents(callback: EventCallback): void {
    this.eventManager.subscribe(EventType.EXECUTION, callback);
  }
}
