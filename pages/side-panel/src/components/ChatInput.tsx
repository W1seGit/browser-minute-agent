import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { FiPaperclip, FiSend, FiSquare, FiX } from 'react-icons/fi';
import { t } from '@extension/i18n';
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from './prompt-kit/prompt-input';

interface ChatInputProps {
  onSendMessage: (text: string, displayText?: string) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  // Historical session ID - if provided, shows replay button instead of send button
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
}

// File attachment interface
interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  setContent,
  historicalSessionId,
  onReplay,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0),
    [disabled, text, attachedFiles],
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedText = text.trim();

      if (trimmedText || attachedFiles.length > 0) {
        let messageContent = trimmedText;
        let displayContent = trimmedText;

        // Security: Clearly separate user input from file content
        // The background service will sanitize file content using guardrails
        if (attachedFiles.length > 0) {
          const fileContents = attachedFiles
            .map(file => {
              // Tag file content for background service to identify and sanitize
              return `\n\n<nano_file_content type="file" name="${file.name}">\n${file.content}\n</nano_file_content>`;
            })
            .join('\n');

          // Combine user message with tagged file content (for background service)
          messageContent = trimmedText
            ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
            : `<nano_attached_files>${fileContents}</nano_attached_files>`;

          // Create display version with only filenames (for UI)
          const fileList = attachedFiles.map(file => `Attached: ${file.name}`).join('\n');
          displayContent = trimmedText ? `${trimmedText}\n\n${fileList}` : fileList;
        }

        onSendMessage(messageContent, displayContent);
        setText('');
        setAttachedFiles([]);
      }
    },
    [text, attachedFiles, onSendMessage],
  );

  const handleReplay = useCallback(() => {
    if (historicalSessionId && onReplay) {
      onReplay(historicalSessionId);
    }
  }, [historicalSessionId, onReplay]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: AttachedFile[] = [];
    const allowedTypes = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.xml', '.yaml', '.yml'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();

      // Check if file type is allowed
      if (!allowedTypes.includes(fileExt)) {
        console.warn(`File type ${fileExt} not supported. Only text-based files are allowed.`);
        continue;
      }

      // Check file size (limit to 1MB)
      if (file.size > 1024 * 1024) {
        console.warn(`File ${file.name} is too large. Maximum size is 1MB.`);
        continue;
      }

      try {
        const content = await file.text();
        newFiles.push({
          name: file.name,
          content,
          type: file.type || 'text/plain',
        });
      } catch (error) {
        console.error(`Error reading file ${file.name}:`, error);
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <form onSubmit={handleSubmit} aria-label={t('chat_input_form')}>
      <PromptInput
        value={text}
        onValueChange={setText}
        onSubmit={() => handleSubmit({ preventDefault: () => undefined } as React.FormEvent)}
        disabled={disabled}
        isLoading={showStopButton || isProcessingSpeech}
        maxHeight={132}
        className="border-zinc-800 bg-[#111113] shadow-xl shadow-black/25 transition-colors focus-within:border-orange-300/60 hover:border-zinc-700">
        {/* File attachments display */}
        {attachedFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 border-b border-zinc-800 px-2 pb-2">
            {attachedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
                <FiPaperclip className="size-3" />
                <span className="max-w-[150px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(index)}
                  className="ml-1 cursor-pointer rounded-sm transition-colors hover:bg-white/10 hover:text-zinc-100"
                  aria-label={`Remove ${file.name}`}>
                  <FiX className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <PromptInputTextarea
          aria-disabled={disabled}
          className="px-3 py-2 text-zinc-100 placeholder:text-zinc-600"
          placeholder={attachedFiles.length > 0 ? 'Add a message (optional)...' : t('chat_input_placeholder')}
          aria-label={t('chat_input_editor')}
        />

        <div className="flex items-center justify-between px-1 pb-1 pt-2">
          <PromptInputActions className="text-zinc-500">
            {/* File attachment button */}
            <PromptInputAction tooltip="Attach text files" disabled={disabled}>
              <button
                type="button"
                onClick={handleFileSelect}
                disabled={disabled}
                aria-label="Attach files"
                className="cursor-pointer rounded-md p-2 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50">
                <FiPaperclip className="size-4" />
              </button>
            </PromptInputAction>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.log,.xml,.yaml,.yml"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />

            {onMicClick && (
              <PromptInputAction
                tooltip={isProcessingSpeech ? t('chat_stt_processing') : t('chat_stt_input_start')}
                disabled={disabled || isProcessingSpeech}>
                <button
                  type="button"
                  onClick={onMicClick}
                  disabled={disabled || isProcessingSpeech}
                  aria-label={
                    isProcessingSpeech
                      ? t('chat_stt_processing')
                      : isRecording
                        ? t('chat_stt_recording_stop')
                        : t('chat_stt_input_start')
                  }
                  className={`cursor-pointer rounded-xl p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isRecording
                      ? 'bg-rose-500 text-white hover:bg-rose-600'
                      : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100'
                  }`}>
                  {isProcessingSpeech ? (
                    <AiOutlineLoading3Quarters className="size-4 animate-spin" />
                  ) : (
                    <FaMicrophone className={`size-4 ${isRecording ? 'animate-pulse' : ''}`} />
                  )}
                </button>
              </PromptInputAction>
            )}
          </PromptInputActions>

          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-rose-500 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-600">
              <FiSquare className="size-3.5" />
              <span>{t('chat_buttons_stop')}</span>
            </button>
          ) : historicalSessionId ? (
            <button
              type="button"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              aria-disabled={!historicalSessionId}
              className={`rounded-md bg-emerald-300 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:enabled:bg-emerald-200 ${!historicalSessionId ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
              {t('chat_buttons_replay')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`inline-flex items-center gap-2 rounded-md bg-orange-300 px-3.5 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:enabled:bg-orange-200 ${isSendButtonDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
              <FiSend className="size-4" />
              <span>{t('chat_buttons_send')}</span>
            </button>
          )}
        </div>
      </PromptInput>
    </form>
  );
}
