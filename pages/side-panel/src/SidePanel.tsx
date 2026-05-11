/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { FiArrowLeft, FiClock, FiSettings } from 'react-icons/fi';
import { PiPlusBold } from 'react-icons/pi';
import { GrHistory } from 'react-icons/gr';
import {
  type Message,
  Actors,
  AgentNameEnum,
  chatHistoryStore,
  agentModelStore,
  generalSettingsStore,
  llmProviderStore,
} from '@extension/storage';
import favoritesStorage from '@extension/storage/lib/prompt/favorites';
import { t } from '@extension/i18n';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import ChatHistoryList from './components/ChatHistoryList';
import ModelSelector from './components/ModelSelector';
import { EventType, type AgentEvent, ExecutionState } from './types/event';
import './SidePanel.css';

// Declare chrome API types
declare global {
  interface Window {
    chrome: typeof chrome;
  }
}

const TOOL_MESSAGE_PREFIX = '__bma_tool_call__:';
const REASONING_MESSAGE_PREFIX = '__bma_reasoning__:';

type ParsedToolDetails = {
  id?: string;
  name: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function parseToolMessageContent(content: string) {
  if (!content.startsWith(TOOL_MESSAGE_PREFIX)) return null;
  try {
    return JSON.parse(content.slice(TOOL_MESSAGE_PREFIX.length)) as {
      id?: string;
      name: string;
      state: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
      rawText?: string;
    };
  } catch {
    return null;
  }
}

function createToolMessageContent(
  state: ExecutionState.ACT_START | ExecutionState.ACT_OK | ExecutionState.ACT_FAIL,
  details = '',
) {
  if (isDoneAction(details)) return null;

  const toolState =
    state === ExecutionState.ACT_START
      ? 'input-streaming'
      : state === ExecutionState.ACT_FAIL
        ? 'output-error'
        : 'output-available';
  const parsed = parseToolDetails(details);
  if (!parsed) return null;

  return `${TOOL_MESSAGE_PREFIX}${JSON.stringify({
    name: parsed.name,
    id: parsed.id,
    state: toolState,
    input: parsed.input,
    output: toolState === 'output-available' ? parsed.output : undefined,
    errorText: toolState === 'output-error' ? parsed.errorText : undefined,
    rawText: details,
  })}`;
}

function createReasoningMessageContent(text: string) {
  return `${REASONING_MESSAGE_PREFIX}${JSON.stringify({ text })}`;
}

function isDoneAction(details: string) {
  const trimmed = details.trim().toLowerCase();
  return (
    trimmed === 'done' ||
    trimmed === 'done completed' ||
    trimmed === 'done failed' ||
    trimmed.startsWith('done:') ||
    trimmed.startsWith('done ')
  );
}

function parseToolDetails(details: string): ParsedToolDetails | null {
  const match = details.match(/^([a-zA-Z_][\w-]*):\s*([\s\S]+)$/);
  if (match) {
    const [, name, rawPayload] = match;
    try {
      return {
        name,
        ...normalizeToolPayload(JSON.parse(rawPayload)),
      };
    } catch {
      return {
        name,
        input: { details: rawPayload.trim() },
        output: undefined,
        errorText: undefined,
      };
    }
  }

  const completed = details.match(/^([a-zA-Z_][\w-]*) completed$/);
  if (completed) {
    return {
      name: completed[1],
      input: undefined,
      output: { status: details },
      errorText: undefined,
    };
  }

  const failed = details.match(/^([a-zA-Z_][\w-]*) failed$/);
  if (failed) {
    return {
      name: failed[1],
      input: undefined,
      output: undefined,
      errorText: details,
    };
  }

  return null;
}

function normalizeToolPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return {
      input: payload,
      output: undefined,
      errorText: undefined,
    };
  }

  const record = payload as Record<string, unknown>;
  const legacyInput =
    record.input === undefined && record.result === undefined && record.error === undefined
      ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'toolCallId'))
      : undefined;

  return {
    id: typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    input:
      record.input && typeof record.input === 'object'
        ? (record.input as Record<string, unknown>)
        : legacyInput && Object.keys(legacyInput).length > 0
          ? legacyInput
          : undefined,
    output: record.result !== undefined ? { result: record.result } : undefined,
    errorText: typeof record.error === 'string' ? record.error : undefined,
  };
}

const SidePanel = () => {
  const progressMessage = 'Showing progress...';
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputEnabled, setInputEnabled] = useState(true);
  const [showStopButton, setShowStopButton] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; createdAt: number }>>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState(false);
  const [isHistoricalSession, setIsHistoricalSession] = useState(false);
  const [hasProviders, setHasProviders] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [replayEnabled, setReplayEnabled] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const setInputTextRef = useRef<((text: string) => void) | null>(null);
  const streamingMessageRef = useRef<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  // Check if providers are configured. The model itself is selected from the side panel.
  const checkModelConfiguration = useCallback(async () => {
    try {
      const providers = await llmProviderStore.getAllProviders();
      setHasProviders(Object.keys(providers).length > 0);
    } catch (error) {
      console.error('Error checking provider configuration:', error);
      setHasProviders(false);
    }
  }, []);

  // Load general settings to check if replay is enabled
  const loadGeneralSettings = useCallback(async () => {
    try {
      const settings = await generalSettingsStore.getSettings();
      setReplayEnabled(settings.replayHistoricalTasks);
    } catch (error) {
      console.error('Error loading general settings:', error);
      setReplayEnabled(false);
    }
  }, []);

  // Check model configuration on mount
  useEffect(() => {
    checkModelConfiguration();
    loadGeneralSettings();
  }, [checkModelConfiguration, loadGeneralSettings]);

  // Re-check model configuration when the side panel becomes visible again
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Panel became visible, re-check configuration and settings
        checkModelConfiguration();
        loadGeneralSettings();
      }
    };

    const handleFocus = () => {
      // Panel gained focus, re-check configuration and settings
      checkModelConfiguration();
      loadGeneralSettings();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfiguration, loadGeneralSettings]);

  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  const appendMessage = useCallback((newMessage: Message, sessionId?: string | null) => {
    // Don't save progress messages
    const isProgressMessage = newMessage.content === progressMessage;
    const newToolMessage = parseToolMessageContent(newMessage.content);

    setMessages(prev => {
      const filteredMessages = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
      if (newToolMessage && newToolMessage.state !== 'input-streaming') {
        let replaceIndex = -1;
        for (let index = filteredMessages.length - 1; index >= 0; index -= 1) {
          const existingToolMessage = parseToolMessageContent(filteredMessages[index].content);
          const sameToolCall =
            newToolMessage.id && existingToolMessage?.id
              ? existingToolMessage.id === newToolMessage.id
              : existingToolMessage?.name === newToolMessage.name && existingToolMessage.state === 'input-streaming';
          if (sameToolCall) {
            replaceIndex = index;
            break;
          }
        }

        if (replaceIndex >= 0) {
          const existingToolMessage = parseToolMessageContent(filteredMessages[replaceIndex].content);
          const mergedMessage =
            existingToolMessage && newToolMessage
              ? {
                  ...newMessage,
                  content: `${TOOL_MESSAGE_PREFIX}${JSON.stringify({
                    ...newToolMessage,
                    input: newToolMessage.input ?? existingToolMessage.input,
                  })}`,
                }
              : newMessage;
          return [
            ...filteredMessages.slice(0, replaceIndex),
            mergedMessage,
            ...filteredMessages.slice(replaceIndex + 1),
          ];
        }
      }
      return [...filteredMessages, newMessage];
    });

    // Use provided sessionId if available, otherwise fall back to sessionIdRef.current
    const effectiveSessionId = sessionId !== undefined ? sessionId : sessionIdRef.current;

    console.log('sessionId', effectiveSessionId);

    // Save message to storage if we have a session and it's not a progress message
    if (effectiveSessionId && !isProgressMessage) {
      chatHistoryStore
        .addMessage(effectiveSessionId, newMessage)
        .catch(err => console.error('Failed to save message to history:', err));
    }
  }, []);

  const appendReasoningDelta = useCallback((actor: Actors, delta: string, timestamp: number) => {
    if (!delta) return;

    setMessages(prev => {
      const filteredMessages = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
      const lastMessage = filteredMessages[filteredMessages.length - 1];

      if (lastMessage?.actor === actor && lastMessage.content.startsWith(REASONING_MESSAGE_PREFIX)) {
        try {
          const parsed = JSON.parse(lastMessage.content.slice(REASONING_MESSAGE_PREFIX.length)) as { text?: string };
          return [
            ...filteredMessages.slice(0, -1),
            {
              ...lastMessage,
              content: createReasoningMessageContent(`${parsed.text ?? ''}${delta}`),
              timestamp,
            },
          ];
        } catch {
          return filteredMessages;
        }
      }

      return [
        ...filteredMessages,
        {
          actor,
          content: createReasoningMessageContent(delta),
          timestamp,
        },
      ];
    });
  }, []);

  const appendStreamDelta = useCallback((actor: Actors, delta: string, timestamp: number) => {
    if (!delta) return;

    setMessages(prev => {
      const filteredMessages = prev.filter((msg, idx) => !(msg.content === progressMessage && idx === prev.length - 1));
      const lastMessage = filteredMessages[filteredMessages.length - 1];
      const previousContent =
        lastMessage?.actor === actor && lastMessage.content === streamingMessageRef.current
          ? streamingMessageRef.current
          : '';
      const content = previousContent + delta;
      streamingMessageRef.current = content;

      if (lastMessage?.actor === actor && lastMessage.content === previousContent) {
        return [
          ...filteredMessages.slice(0, -1),
          {
            ...lastMessage,
            content,
            timestamp,
          },
        ];
      }

      return [
        ...filteredMessages,
        {
          actor,
          content,
          timestamp,
        },
      ];
    });
  }, []);

  const finalizeStreamingMessage = useCallback((actor: Actors, content: string, timestamp: number) => {
    const streamedContent = streamingMessageRef.current;
    streamingMessageRef.current = '';

    if (!streamedContent || !content) return false;

    const finalMessage = { actor, content, timestamp };
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage?.actor === actor && lastMessage.content === streamedContent) {
        return [...prev.slice(0, -1), finalMessage];
      }
      return [...prev, finalMessage];
    });

    if (sessionIdRef.current) {
      chatHistoryStore
        .addMessage(sessionIdRef.current, finalMessage)
        .catch(err => console.error('Failed to save message to history:', err));
    }

    return true;
  }, []);

  const handleTaskState = useCallback(
    (event: AgentEvent) => {
      const { actor, state, timestamp, data } = event;
      const content = data?.details;
      let skip = true;
      let displayProgress = false;

      switch (actor) {
        case Actors.SYSTEM:
          switch (state) {
            case ExecutionState.TASK_START:
              // Reset historical session flag when a new task starts
              setIsHistoricalSession(false);
              streamingMessageRef.current = '';
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              if (finalizeStreamingMessage(actor, content, timestamp)) return;
              skip = !content;
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = false;
              break;
            case ExecutionState.TASK_PAUSE:
              break;
            case ExecutionState.TASK_RESUME:
              break;
            default:
              console.error('Invalid task state', state);
              return;
          }
          break;
        case Actors.USER:
          break;
        case Actors.NAVIGATOR:
          switch (state) {
            case ExecutionState.TASK_START:
              setIsHistoricalSession(false);
              streamingMessageRef.current = '';
              break;
            case ExecutionState.TASK_OK:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              if (finalizeStreamingMessage(actor, content, timestamp)) return;
              skip = !content;
              break;
            case ExecutionState.TASK_FAIL:
              setIsFollowUpMode(true);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = false;
              break;
            case ExecutionState.TASK_CANCEL:
              setIsFollowUpMode(false);
              setInputEnabled(true);
              setShowStopButton(false);
              skip = false;
              break;
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              displayProgress = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              displayProgress = false;
              break;
            case ExecutionState.STEP_CANCEL:
              displayProgress = false;
              break;
            case ExecutionState.ACT_START:
              if (content !== 'cache_content' && content !== 'done') {
                const toolMessage = createToolMessageContent(state, content);
                if (toolMessage) {
                  appendMessage({
                    actor,
                    content: toolMessage,
                    timestamp,
                  });
                }
              }
              return;
            case ExecutionState.ACT_OK:
              if (content && content !== 'done') {
                const toolMessage = createToolMessageContent(state, content);
                if (toolMessage) {
                  appendMessage({
                    actor,
                    content: toolMessage,
                    timestamp,
                  });
                }
              }
              return;
            case ExecutionState.ACT_FAIL:
              {
                const toolMessage = createToolMessageContent(state, content);
                if (toolMessage) {
                  appendMessage({
                    actor,
                    content: toolMessage,
                    timestamp,
                  });
                }
              }
              return;
            case ExecutionState.STREAM_THINKING:
              appendReasoningDelta(actor, content, timestamp);
              return;
            case ExecutionState.STREAM_TEXT:
              appendStreamDelta(actor, content, timestamp);
              return;
            default:
              console.error('Invalid action', state);
              return;
          }
          break;
        case Actors.VALIDATOR:
          // Handle legacy validator events from historical messages
          switch (state) {
            case ExecutionState.STEP_START:
              displayProgress = true;
              break;
            case ExecutionState.STEP_OK:
              skip = false;
              break;
            case ExecutionState.STEP_FAIL:
              skip = false;
              break;
            default:
              console.error('Invalid validation', state);
              return;
          }
          break;
        default:
          console.error('Unknown actor', actor);
          return;
      }

      if (!skip) {
        appendMessage({
          actor,
          content: content || '',
          timestamp: timestamp,
        });
      }

      if (displayProgress) {
        appendMessage({
          actor,
          content: progressMessage,
          timestamp: timestamp,
        });
      }
    },
    [appendMessage, appendStreamDelta, finalizeStreamingMessage],
  );

  // Stop heartbeat and close connection
  const stopConnection = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (portRef.current) {
      portRef.current.disconnect();
      portRef.current = null;
    }
  }, []);

  // Setup connection management
  const setupConnection = useCallback(() => {
    // Only setup if no existing connection
    if (portRef.current) {
      return;
    }

    try {
      portRef.current = chrome.runtime.connect({ name: 'side-panel-connection' });

      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      portRef.current.onMessage.addListener((message: any) => {
        // Add type checking for message
        if (message && message.type === EventType.EXECUTION) {
          handleTaskState(message);
        } else if (message && message.type === 'error') {
          // Handle error messages from service worker
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('errors_unknown'),
            timestamp: Date.now(),
          });
          setInputEnabled(true);
          setShowStopButton(false);
        } else if (message && message.type === 'speech_to_text_result') {
          // Handle speech-to-text result
          if (message.text && setInputTextRef.current) {
            setInputTextRef.current(message.text);
          }
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'speech_to_text_error') {
          // Handle speech-to-text error
          appendMessage({
            actor: Actors.SYSTEM,
            content: message.error || t('chat_stt_recognitionFailed'),
            timestamp: Date.now(),
          });
          setIsProcessingSpeech(false);
        } else if (message && message.type === 'heartbeat_ack') {
          console.log('Heartbeat acknowledged');
        }
      });

      portRef.current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        console.log('Connection disconnected', error ? `Error: ${error.message}` : '');
        portRef.current = null;
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        setInputEnabled(true);
        setShowStopButton(false);
      });

      // Setup heartbeat interval
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      heartbeatIntervalRef.current = window.setInterval(() => {
        if (portRef.current?.name === 'side-panel-connection') {
          try {
            portRef.current.postMessage({ type: 'heartbeat' });
          } catch (error) {
            console.error('Heartbeat failed:', error);
            stopConnection(); // Stop connection if heartbeat fails
          }
        } else {
          stopConnection(); // Stop if port is invalid
        }
      }, 25000);
    } catch (error) {
      console.error('Failed to establish connection:', error);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_conn_serviceWorker'),
        timestamp: Date.now(),
      });
      // Clear any references since connection failed
      portRef.current = null;
    }
  }, [handleTaskState, appendMessage, stopConnection]);

  // Add safety check for message sending
  const sendMessage = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (message: any) => {
      if (portRef.current?.name !== 'side-panel-connection') {
        throw new Error('No valid connection available');
      }
      try {
        portRef.current.postMessage(message);
      } catch (error) {
        console.error('Failed to send message:', error);
        stopConnection(); // Stop connection when message sending fails
        throw error;
      }
    },
    [stopConnection],
  );

  // Handle replay command
  const handleReplay = async (historySessionId: string): Promise<void> => {
    try {
      // Check if replay is enabled in settings
      if (!replayEnabled) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_disabled'),
          timestamp: Date.now(),
        });
        return;
      }

      // Check if history exists using loadAgentStepHistory
      const historyData = await chatHistoryStore.loadAgentStepHistory(historySessionId);
      if (!historyData) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_replay_noHistory', historySessionId.substring(0, 20)),
          timestamp: Date.now(),
        });
        return;
      }

      // Get current tab ID
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Clear messages if we're in a historical session
      if (isHistoricalSession) {
        setMessages([]);
      }

      // Create a new chat session for this replay task
      const newSession = await chatHistoryStore.createSession(`Replay of ${historySessionId.substring(0, 20)}...`);
      console.log('newSession for replay', newSession);

      // Store the new session ID in both state and ref
      const newTaskId = newSession.id;
      setCurrentSessionId(newTaskId);
      sessionIdRef.current = newTaskId;

      // Send replay command to background
      setInputEnabled(false);
      setShowStopButton(true);

      // Reset follow-up mode and historical session flags
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);

      const userMessage = {
        actor: Actors.USER,
        content: `/replay ${historySessionId}`,
        timestamp: Date.now(),
      };

      // Add the user message to the new session
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send replay command to background with the task from history
      portRef.current?.postMessage({
        type: 'replay',
        taskId: newTaskId,
        tabId: tabId,
        historySessionId: historySessionId,
        task: historyData.task, // Add the task from history
      });

      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_starting', historyData.task),
        timestamp: Date.now(),
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('chat_replay_failed', errorMessage),
        timestamp: Date.now(),
      });
    }
  };

  // Handle chat commands that start with /
  const handleCommand = async (command: string): Promise<boolean> => {
    try {
      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Handle different commands
      if (command === '/state') {
        portRef.current?.postMessage({
          type: 'state',
        });
        return true;
      }

      if (command === '/nohighlight') {
        portRef.current?.postMessage({
          type: 'nohighlight',
        });
        return true;
      }

      if (command.startsWith('/replay ')) {
        // Parse replay command: /replay <historySessionId>
        // Handle multiple spaces by filtering out empty strings
        const parts = command.split(' ').filter(part => part.trim() !== '');
        if (parts.length !== 2) {
          appendMessage({
            actor: Actors.SYSTEM,
            content: t('chat_replay_invalidArgs'),
            timestamp: Date.now(),
          });
          return true;
        }

        const historySessionId = parts[1];
        await handleReplay(historySessionId);
        return true;
      }

      // Unsupported command
      appendMessage({
        actor: Actors.SYSTEM,
        content: t('errors_cmd_unknown', command),
        timestamp: Date.now(),
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Command error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      return true;
    }
  };

  const handleSendMessage = async (text: string, displayText?: string) => {
    console.log('handleSendMessage', text);

    // Trim the input text first
    const trimmedText = text.trim();

    if (!trimmedText) return;

    // Check if the input is a command (starts with /)
    if (trimmedText.startsWith('/')) {
      // Process command and return if it was handled
      const wasHandled = await handleCommand(trimmedText);
      if (wasHandled) return;
    }

    // Block sending messages in historical sessions
    if (isHistoricalSession) {
      console.log('Cannot send messages in historical sessions');
      return;
    }

    try {
      const hasSelectedModel = await agentModelStore.hasAgentModel(AgentNameEnum.MinAgent);
      if (!hasSelectedModel) {
        appendMessage({
          actor: Actors.SYSTEM,
          content: 'Select a model before sending a message.',
          timestamp: Date.now(),
        });
        return;
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      setInputEnabled(false);
      setShowStopButton(true);

      // Create a new chat session for this task if not in follow-up mode
      if (!isFollowUpMode) {
        // Use display text for session title if available, otherwise use full text
        const titleText = displayText || text;
        const newSession = await chatHistoryStore.createSession(
          titleText.substring(0, 50) + (titleText.length > 50 ? '...' : ''),
        );
        console.log('newSession', newSession);

        // Store the session ID in both state and ref
        const sessionId = newSession.id;
        setCurrentSessionId(sessionId);
        sessionIdRef.current = sessionId;
      }

      const userMessage = {
        actor: Actors.USER,
        content: displayText || text, // Use display text for chat UI, full text for background service
        timestamp: Date.now(),
      };

      // Pass the sessionId directly to appendMessage
      appendMessage(userMessage, sessionIdRef.current);

      // Setup connection if not exists
      if (!portRef.current) {
        setupConnection();
      }

      // Send message using the utility function
      if (isFollowUpMode) {
        // Send as follow-up task
        await sendMessage({
          type: 'follow_up_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('follow_up_task sent', text, tabId, sessionIdRef.current);
      } else {
        // Send as new task
        await sendMessage({
          type: 'new_task',
          task: text,
          taskId: sessionIdRef.current,
          tabId,
        });
        console.log('new_task sent', text, tabId, sessionIdRef.current);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setInputEnabled(true);
      setShowStopButton(false);
      stopConnection();
    }
  };

  const handleStopTask = async () => {
    try {
      portRef.current?.postMessage({
        type: 'cancel_task',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('cancel_task error', errorMessage);
      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
    }
    setInputEnabled(true);
    setShowStopButton(false);
  };

  const handleNewChat = () => {
    // Clear messages and start a new chat
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setInputEnabled(true);
    setShowStopButton(false);
    setIsFollowUpMode(false);
    setIsHistoricalSession(false);

    // Disconnect any existing connection
    stopConnection();
  };

  const loadChatSessions = useCallback(async () => {
    try {
      const sessions = await chatHistoryStore.getSessionsMetadata();
      setChatSessions(sessions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    }
  }, []);

  const handleLoadHistory = async () => {
    await loadChatSessions();
    setShowHistory(true);
  };

  const handleBackToChat = (reset = false) => {
    setShowHistory(false);
    if (reset) {
      setCurrentSessionId(null);
      setMessages([]);
      setIsFollowUpMode(false);
      setIsHistoricalSession(false);
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);
      if (fullSession && fullSession.messages.length > 0) {
        setCurrentSessionId(fullSession.id);
        setMessages(fullSession.messages);
        setIsFollowUpMode(false);
        setIsHistoricalSession(true); // Mark this as a historical session
        console.log('history session selected', sessionId);
      }
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  };

  const handleSessionDelete = async (sessionId: string) => {
    try {
      await chatHistoryStore.deleteSession(sessionId);
      await loadChatSessions();
      if (sessionId === currentSessionId) {
        setMessages([]);
        setCurrentSessionId(null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionBookmark = async (sessionId: string) => {
    try {
      const fullSession = await chatHistoryStore.getSession(sessionId);

      if (fullSession && fullSession.messages.length > 0) {
        // Get the session title
        const sessionTitle = fullSession.title;
        // Get the first 8 words of the title
        const title = sessionTitle.split(' ').slice(0, 8).join(' ');

        // Get the first message content (the task)
        const taskContent = fullSession.messages[0]?.content || '';

        // Add to favorites storage
        await favoritesStorage.addPrompt(title, taskContent);

        // Update favorites in the UI
        await favoritesStorage.getAllPrompts();

        // Return to chat view after pinning
        handleBackToChat(true);
      }
    } catch (error) {
      console.error('Failed to pin session to favorites:', error);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop recording if active
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear recording timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopConnection();
    };
  }, [stopConnection]);

  // Scroll to bottom when new messages arrive
  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleMicClick = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      // Clear the timer
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    try {
      // First check if permission is already granted
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        appendMessage({
          actor: Actors.SYSTEM,
          content: t('chat_stt_microphone_permissionDenied'),
          timestamp: Date.now(),
        });
        return;
      }

      // If permission is not granted, open permission page
      if (permissionStatus.state !== 'granted') {
        const permissionUrl = chrome.runtime.getURL('permission/index.html');

        // Open permission page in a new window
        chrome.windows.create(
          {
            url: permissionUrl,
            type: 'popup',
            width: 500,
            height: 600,
          },
          createdWindow => {
            if (createdWindow?.id) {
              // Listen for window close to check permission status
              chrome.windows.onRemoved.addListener(function onWindowClose(windowId) {
                if (windowId === createdWindow.id) {
                  chrome.windows.onRemoved.removeListener(onWindowClose);
                  // Check permission status after window closes
                  setTimeout(async () => {
                    try {
                      const newPermissionStatus = await navigator.permissions.query({
                        name: 'microphone' as PermissionName,
                      });
                      // Only retry if permission was granted
                      if (newPermissionStatus.state === 'granted') {
                        handleMicClick();
                      }
                      // If denied or prompt, do nothing - let user manually try again
                    } catch (error) {
                      console.error('Failed to check permission status:', error);
                    }
                  }, 500);
                }
              });
            }
          },
        );
        return;
      }

      // Permission granted - proceed with recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Clear previous audio chunks
      audioChunksRef.current = [];

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Handle data available event
      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      mediaRecorder.onstop = async () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0) {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

          // Convert blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Audio = reader.result as string;

            // Setup connection if not exists
            if (!portRef.current) {
              setupConnection();
            }

            // Send audio to backend for speech-to-text conversion
            try {
              setIsProcessingSpeech(true);
              portRef.current?.postMessage({
                type: 'speech_to_text',
                audio: base64Audio,
              });
            } catch (error) {
              console.error('Failed to send audio for speech-to-text:', error);
              appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_processingFailed'),
                timestamp: Date.now(),
              });
              setIsRecording(false);
              setIsProcessingSpeech(false);
            }
          };
          reader.readAsDataURL(audioBlob);
        }
      };

      // Set up 2-minute duration limit
      const maxDuration = 2 * 60 * 1000;
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsProcessingSpeech(true);
        recordingTimerRef.current = null;
      }, maxDuration);

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error accessing microphone:', error);

      let errorMessage = t('chat_stt_microphone_accessFailed');
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          errorMessage += t('chat_stt_microphone_grantPermission');
        } else if (error.name === 'NotFoundError') {
          errorMessage += t('chat_stt_microphone_notFound');
        } else {
          errorMessage += error.message;
        }
      }

      appendMessage({
        actor: Actors.SYSTEM,
        content: errorMessage,
        timestamp: Date.now(),
      });
      setIsRecording(false);
    }
  };

  return (
    <div className="bg-bma-bg text-bma-text">
      <div className="side-panel-shell flex h-screen flex-col overflow-hidden bg-bma-bg text-bma-text">
        <header className="header relative">
          <div className="header-logo min-w-0 flex-1 gap-3">
            {showHistory ? (
              <button
                type="button"
                onClick={() => handleBackToChat(false)}
                className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
                aria-label={t('nav_back_a11y')}>
                <FiArrowLeft className="size-4" />
                {t('nav_back')}
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-md border border-zinc-800 bg-zinc-950 text-xs font-semibold text-orange-300">
                  bm
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-100">browser minute</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    min-agent
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="header-icons">
            {!showHistory && (
              <>
                <button
                  type="button"
                  onClick={handleNewChat}
                  onKeyDown={e => e.key === 'Enter' && handleNewChat()}
                  className="header-icon"
                  aria-label={t('nav_newChat_a11y')}
                  tabIndex={0}>
                  <PiPlusBold size={20} />
                </button>
                <button
                  type="button"
                  onClick={handleLoadHistory}
                  onKeyDown={e => e.key === 'Enter' && handleLoadHistory()}
                  className="header-icon"
                  aria-label={t('nav_loadHistory_a11y')}
                  tabIndex={0}>
                  <GrHistory size={20} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => chrome.runtime.openOptionsPage()}
              onKeyDown={e => e.key === 'Enter' && chrome.runtime.openOptionsPage()}
              className="header-icon"
              aria-label={t('nav_settings_a11y')}
              tabIndex={0}>
              <FiSettings size={20} />
            </button>
          </div>
        </header>
        {showHistory ? (
          <div className="flex-1 overflow-hidden">
            <ChatHistoryList
              sessions={chatSessions}
              onSessionSelect={handleSessionSelect}
              onSessionDelete={handleSessionDelete}
              onSessionBookmark={handleSessionBookmark}
              visible={true}
              isDarkMode={true}
            />
          </div>
        ) : (
          <>
            {/* Show loading state while checking model configuration */}
            {hasProviders === null && (
              <div className="flex flex-1 items-center justify-center p-8 text-bma-muted">
                <div className="text-center">
                  <div className="mx-auto mb-4 size-8 animate-spin rounded-full border-2 border-zinc-800 border-t-orange-300"></div>
                  <p>{t('status_checkingConfig')}</p>
                </div>
              </div>
            )}

            {/* Show setup message when no models are configured */}
            {hasProviders === false && (
              <div className="flex flex-1 items-center justify-center p-6 text-bma-muted">
                <div className="max-w-md rounded-xl border border-zinc-800 bg-[#111113] p-5 text-center shadow-xl shadow-black/20">
                  <h3 className="mb-2 text-lg font-semibold text-zinc-100">Add a provider</h3>
                  <p className="mb-4 text-sm text-zinc-400">
                    Connect a provider in settings, then pick a model next to the input.
                  </p>
                  <button
                    onClick={() => chrome.runtime.openOptionsPage()}
                    className="my-2 cursor-pointer rounded-md bg-orange-300 px-4 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-orange-200">
                    Open settings
                  </button>
                </div>
              </div>
            )}

            {/* Show normal chat interface when models are configured */}
            {hasProviders === true && (
              <>
                {messages.length === 0 && (
                  <div className="flex flex-1 items-center justify-center bg-bma-bg p-4">
                    <div className="w-full max-w-2xl">
                      <div className="mb-5 text-center">
                        <div className="mx-auto mb-3 grid size-11 place-items-center rounded-lg border border-zinc-800 bg-[#111113] text-orange-300">
                          <FiClock className="size-5" />
                        </div>
                        <h1 className="text-xl font-semibold text-zinc-100">What should the browser do?</h1>
                        <p className="mt-1 text-sm text-zinc-500">
                          Tool calls and page actions will appear as structured run cards.
                        </p>
                      </div>
                      <div className="mb-3 flex items-center justify-between px-1">
                        <span className="text-xs font-medium uppercase text-zinc-500">Model</span>
                        <ModelSelector onModelConfigured={checkModelConfiguration} />
                      </div>
                      <ChatInput
                        onSendMessage={handleSendMessage}
                        onStopTask={handleStopTask}
                        onMicClick={handleMicClick}
                        isRecording={isRecording}
                        isProcessingSpeech={isProcessingSpeech}
                        disabled={!inputEnabled || isHistoricalSession}
                        showStopButton={showStopButton}
                        setContent={setter => {
                          setInputTextRef.current = setter;
                        }}
                        historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                        onReplay={handleReplay}
                      />
                    </div>
                  </div>
                )}
                {messages.length > 0 && (
                  <div className="scrollbar-gutter-stable flex-1 overflow-x-hidden overflow-y-scroll scroll-smooth bg-bma-bg">
                    <MessageList messages={messages} />
                    <div ref={messagesEndRef} />
                  </div>
                )}
                {messages.length > 0 && (
                  <div className="composer-dock border-t border-zinc-800 bg-bma-bg-soft p-3">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-xs font-medium uppercase text-zinc-500">Model</span>
                      <ModelSelector onModelConfigured={checkModelConfiguration} />
                    </div>
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      onStopTask={handleStopTask}
                      onMicClick={handleMicClick}
                      isRecording={isRecording}
                      isProcessingSpeech={isProcessingSpeech}
                      disabled={!inputEnabled || isHistoricalSession}
                      showStopButton={showStopButton}
                      setContent={setter => {
                        setInputTextRef.current = setter;
                      }}
                      historicalSessionId={isHistoricalSession && replayEnabled ? currentSessionId : null}
                      onReplay={handleReplay}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SidePanel;
