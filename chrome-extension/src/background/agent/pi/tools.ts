import { Type, type TSchema, type Static } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { ActionResult, type AgentContext } from '../types';
import { createLogger } from '@src/background/log';
import { t } from '@extension/i18n';
import type { ExtractContentMode } from '../../browser/page';

const logger = createLogger('PiTools');

export interface PiToolContext {
  agentContext: AgentContext;
  onDone?: (text: string, success: boolean) => void;
}

function buildResult(result: ActionResult): AgentToolResult<unknown> {
  const text = result.error ? `Error: ${result.error}` : result.extractedContent || 'Action completed';
  return {
    content: [{ type: 'text', text }],
    details: result,
    terminate: result.isDone,
  };
}

async function resultWithCurrentUrl(context: AgentContext, result: ActionResult): Promise<ActionResult> {
  const page = await context.browserContext.getCurrentPage();
  const state = page.getCachedState() ?? (await page.getState(false));
  result.currentUrl = state.url;
  return result;
}

function formatBrowserState(
  context: AgentContext,
  state: Awaited<ReturnType<AgentContext['browserContext']['getState']>>,
) {
  const tabs = state.tabs.map(tab => `Tab ${tab.id}: ${tab.title || '(untitled)'} - ${tab.url}`).join('\n');
  const elementsText = state.elementTree.clickableElementsToString(context.options.includeAttributes);
  return [
    `URL: ${state.url}`,
    `Title: ${state.title}`,
    `Scroll: ${state.scrollY}/${state.scrollHeight} viewport=${state.visualViewportHeight}`,
    `Tabs:\n${tabs || '(none)'}`,
    `Interactive elements:\n${elementsText || '(none)'}`,
  ].join('\n\n');
}

function createTool<T extends TSchema>(
  name: string,
  label: string,
  description: string,
  parameters: T,
  execute: (toolCallId: string, params: Static<T>, signal?: AbortSignal) => Promise<AgentToolResult<unknown>>,
): AgentTool<T> {
  return { name, label, description, parameters, execute, executionMode: 'sequential' };
}

const optionalIntent = Type.Optional(Type.String({ description: 'purpose of this action' }));

export function createBrowserTools(ctx: PiToolContext): AgentTool[] {
  const { agentContext: context } = ctx;

  return [
    createTool(
      'done',
      'done',
      'Complete the task. Prefer streaming the final answer as normal assistant text before calling this tool with an empty text value.',
      Type.Object({
        text: Type.Optional(
          Type.String({ default: '', description: 'leave empty; final answers must be normal assistant text' }),
        ),
        success: Type.Optional(Type.Boolean({ default: true })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const text = params.text ?? '';
        context.finalAnswer = text;
        const result = new ActionResult({
          toolName: 'done',
          isDone: true,
          success: params.success,
          extractedContent: text || 'Task completed',
        });
        if (ctx.onDone) {
          ctx.onDone(text, params.success ?? true);
        }
        return buildResult(result);
      },
    ),

    createTool(
      'observe',
      'observe',
      'Refresh and return the current browser state. Use this after uncertainty, unexpected results, or before choosing an element when recent state may be stale.',
      Type.Object({
        intent: optionalIntent,
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const state = await context.browserContext.getState(context.options.useVision, true);
        return buildResult(
          new ActionResult({
            toolName: 'observe',
            success: true,
            extractedContent: formatBrowserState(context, state),
            includeInMemory: false,
            currentUrl: state.url,
            data: {
              url: state.url,
              title: state.title,
              tabCount: state.tabs.length,
              interactiveElementCount: state.selectorMap.size,
              scrollY: state.scrollY,
              scrollHeight: state.scrollHeight,
            },
          }),
        );
      },
    ),

    createTool(
      'search_google',
      'search_google',
      'Search the query in Google in the current tab, the query should be a search query like humans search in Google, concrete and not vague or super long. More the single most important items.',
      Type.Object({
        intent: optionalIntent,
        query: Type.String({ description: 'search query' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        await context.browserContext.navigateTo(`https://www.google.com/search?q=${encodeURIComponent(params.query)}`);
        const msg = t('act_searchGoogle_ok', [params.query]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'search_google',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
            }),
          ),
        );
      },
    ),

    createTool(
      'go_to_url',
      'go_to_url',
      'Navigate to URL in the current tab',
      Type.Object({
        intent: optionalIntent,
        url: Type.String({ description: 'URL to navigate to' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        await context.browserContext.navigateTo(params.url);
        const msg = t('act_goToUrl_ok', [params.url]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'go_to_url',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
            }),
          ),
        );
      },
    ),

    createTool(
      'go_back',
      'go_back',
      'Go back to the previous page',
      Type.Object({ intent: optionalIntent }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        await page.goBack();
        const msg = t('act_goBack_ok');
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'go_back',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
            }),
          ),
        );
      },
    ),

    createTool(
      'reload',
      'reload',
      'Reload the current page. Use this only when the page appears stale, broken, or partially loaded.',
      Type.Object({ intent: optionalIntent }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        await page.refreshPage();
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'reload',
              success: true,
              extractedContent: 'Reloaded current page',
              includeInMemory: true,
              pageChanged: true,
            }),
          ),
        );
      },
    ),

    createTool(
      'click_element',
      'click_element',
      'Click an element by index. Use this once to focus or activate a target. If this is an editor, input, IDE, or terminal, use input_text next.',
      Type.Object({
        intent: optionalIntent,
        index: Type.Number({ description: 'index of the element' }),
        xpath: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'xpath of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = state?.selectorMap.get(params.index);
        if (!elementNode) {
          throw new Error(t('act_errors_elementNotExist', [params.index.toString()]));
        }
        if (page.isFileUploader(elementNode)) {
          const msg = t('act_click_fileUploader', [params.index.toString()]);
          logger.info(msg);
          return buildResult(
            new ActionResult({
              toolName: 'click_element',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { index: params.index, fileUploader: true },
            }),
          );
        }
        const initialTabIds = await context.browserContext.getAllTabIds();
        const beforeUrl = state.url;
        await page.clickElementNode(context.options.useVision, elementNode);
        let msg = t('act_click_ok', [params.index.toString(), elementNode.getAllTextTillNextClickableElement(2)]);
        msg += '\n\nClick succeeded. For editor/input/terminal targets, use input_text next.';
        await page.waitForPageAndFramesLoad();
        const newTabIds = await context.browserContext.getAllTabIds();
        let newTabOpened = false;
        if (newTabIds.size > initialTabIds.size) {
          newTabOpened = true;
          msg += '\n\nNew tab opened. Focused on new tab.';
          const newTabs = Array.from(newTabIds);
          const newTabId = newTabs[newTabs.length - 1];
          await context.browserContext.addTabsToAiSpace([newTabId]);
          await context.browserContext.switchTab(newTabId);
        }
        const afterState = await context.browserContext.getState(context.options.useVision, true);
        return buildResult(
          new ActionResult({
            toolName: 'click_element',
            success: true,
            extractedContent: msg,
            includeInMemory: true,
            pageChanged: newTabOpened || afterState.url !== beforeUrl,
            newTabOpened,
            currentUrl: afterState.url,
            data: { index: params.index, xpath: params.xpath ?? null },
          }),
        );
      },
    ),

    createTool(
      'input_text',
      'input_text',
      'Type the full text into the currently focused element. Click the target first. For terminals, type the command/input with this tool, then use send_keys for Enter. Do not use this for special keys like Enter or Backspace.',
      Type.Object({
        intent: optionalIntent,
        text: Type.String({ description: 'text to type into the focused element' }),
      }),
      async (_toolCallId, params, signal): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        await page.typeText(params.text, signal);
        const msg = `Typed text: ${params.text}`;
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'input_text',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { textLength: params.text.length },
            }),
          ),
        );
      },
    ),

    createTool(
      'fill_form_fields',
      'fill_form_fields',
      'Fill multiple visible form fields in one planned batch. Use this when several inputs/selectable text fields are visible and you know the values. Build the complete field list first, then call this once instead of alternating click_element and input_text for each field.',
      Type.Object({
        intent: optionalIntent,
        fields: Type.Array(
          Type.Object({
            index: Type.Number({ description: 'index of the form field element' }),
            label: Type.Optional(Type.String({ description: 'human-readable field label' })),
            text: Type.String({ description: 'text value to enter into the field' }),
          }),
          { minItems: 1, description: 'planned field/value pairs to fill' },
        ),
      }),
      async (_toolCallId, params, signal): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const filled: string[] = [];

        for (const field of params.fields) {
          if (signal?.aborted) {
            throw new Error('Fill form fields aborted');
          }

          const elementNode = state?.selectorMap.get(field.index);
          if (!elementNode) {
            throw new Error(t('act_errors_elementNotExist', [field.index.toString()]));
          }

          await page.inputTextElementNode(context.options.useVision, elementNode, field.text);
          filled.push(field.label || `Field ${field.index}`);
        }

        const msg = `Filled ${filled.length} field${filled.length === 1 ? '' : 's'}: ${filled.join(', ')}`;
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'fill_form_fields',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { fields: params.fields.map(field => ({ index: field.index, label: field.label ?? null })) },
            }),
          ),
        );
      },
    ),

    createTool(
      'switch_tab',
      'switch_tab',
      'Switch to tab by tab id',
      Type.Object({
        intent: optionalIntent,
        tab_id: Type.Number({ description: 'id of the tab to switch to' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        await context.browserContext.switchTab(params.tab_id);
        const msg = t('act_switchTab_ok', [params.tab_id.toString()]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'switch_tab',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
              data: { tabId: params.tab_id },
            }),
          ),
        );
      },
    ),

    createTool(
      'open_tab',
      'open_tab',
      'Open URL in new tab',
      Type.Object({
        intent: optionalIntent,
        url: Type.String({ description: 'url to open' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        await context.browserContext.openTab(params.url);
        const msg = t('act_openTab_ok', [params.url]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'open_tab',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
              newTabOpened: true,
            }),
          ),
        );
      },
    ),

    createTool(
      'close_tab',
      'close_tab',
      'Close tab by tab id',
      Type.Object({
        intent: optionalIntent,
        tab_id: Type.Number({ description: 'id of the tab' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        await context.browserContext.closeTab(params.tab_id);
        const msg = t('act_closeTab_ok', [params.tab_id.toString()]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'close_tab',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
              data: { tabId: params.tab_id },
            }),
          ),
        );
      },
    ),

    createTool(
      'cache_content',
      'cache_content',
      'Cache what you have found so far from the current page for future use',
      Type.Object({
        intent: optionalIntent,
        content: Type.String({ default: '', description: 'content to cache' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'cache_content',
              success: true,
              extractedContent: params.content,
              includeInMemory: true,
              data: { contentLength: params.content.length },
            }),
          ),
        );
      },
    ),

    createTool(
      'extract_content',
      'extract_content',
      'Deterministically extract page content without summarizing. Use visible_text for what is on the page, readability for article text, links for URLs, tables for tabular data, and forms for available form controls.',
      Type.Object({
        intent: optionalIntent,
        mode: Type.Union(
          [
            Type.Literal('visible_text'),
            Type.Literal('readability'),
            Type.Literal('links'),
            Type.Literal('tables'),
            Type.Literal('forms'),
          ],
          { default: 'visible_text', description: 'content extraction mode' },
        ),
        maxChars: Type.Optional(Type.Number({ default: 8000, description: 'maximum characters to return' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        const extracted = await page.extractContent(params.mode as ExtractContentMode, params.maxChars ?? 8000);
        const header = [
          `Mode: ${extracted.mode}`,
          `URL: ${extracted.url}`,
          `Title: ${extracted.title}`,
          extracted.itemCount !== undefined ? `Items: ${extracted.itemCount}` : '',
          extracted.truncated ? 'Truncated: true' : 'Truncated: false',
        ]
          .filter(Boolean)
          .join('\n');

        return buildResult(
          new ActionResult({
            toolName: 'extract_content',
            success: true,
            extractedContent: `${header}\n\n${extracted.content || '(no content found)'}`,
            includeInMemory: true,
            currentUrl: extracted.url,
            data: extracted,
          }),
        );
      },
    ),

    createTool(
      'scroll',
      'scroll',
      'Scroll the page or a scrollable element. Use direction "down" or "up" to move one page, or "top"/"bottom" to jump to the start/end. This does not rely on PageUp/PageDown keys, so it works even when an input is focused.',
      Type.Object({
        intent: optionalIntent,
        direction: Type.Union([Type.Literal('top'), Type.Literal('bottom'), Type.Literal('up'), Type.Literal('down')], {
          description: 'scroll direction',
        }),
        index: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: 'index of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = params.index != null ? state?.selectorMap.get(params.index) : undefined;
        await page.scroll(params.direction, elementNode);
        const msg = `Scrolled ${params.direction}`;
        const nextState = await context.browserContext.getState(context.options.useVision, true);
        return buildResult(
          new ActionResult({
            toolName: 'scroll',
            success: true,
            extractedContent: msg,
            includeInMemory: true,
            pageChanged: true,
            currentUrl: nextState.url,
            data: {
              direction: params.direction,
              index: params.index ?? null,
              scrollY: nextState.scrollY,
              scrollHeight: nextState.scrollHeight,
            },
          }),
        );
      },
    ),

    createTool(
      'scroll_to_text',
      'scroll_to_text',
      'If you dont find something which you want to interact with in current viewport, try to scroll to it',
      Type.Object({
        intent: optionalIntent,
        text: Type.String({ description: 'text to scroll to' }),
        nth: Type.Optional(
          Type.Number({ default: 1, description: 'which occurrence of the text to scroll to (1-indexed, default: 1)' }),
        ),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        await page.scrollToText(params.text, params.nth ?? 1);
        const msg = t('act_scrollToText_ok', [params.text]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'scroll_to_text',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              pageChanged: true,
              data: { text: params.text, nth: params.nth ?? 1 },
            }),
          ),
        );
      },
    ),

    createTool(
      'send_keys',
      'send_keys',
      'Send strings of special keys like Backspace, Insert, PageDown, Delete, Enter. Shortcuts such as `Control+o`, `Control+Shift+T` are supported as well. This gets used in keyboard press. Be aware of different operating systems and their shortcuts',
      Type.Object({
        intent: optionalIntent,
        keys: Type.String({ description: 'keys to send' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        await page.sendKeys(params.keys);
        const msg = t('act_sendKeys_ok', [params.keys]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'send_keys',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { keys: params.keys },
            }),
          ),
        );
      },
    ),

    createTool(
      'get_dropdown_options',
      'get_dropdown_options',
      'Get all options from a native dropdown',
      Type.Object({
        intent: optionalIntent,
        index: Type.Number({ description: 'index of the dropdown element' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        const options = await page.getDropdownOptions(params.index);
        const msg = `Dropdown options: ${JSON.stringify(options)}`;
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'get_dropdown_options',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { index: params.index, options },
            }),
          ),
        );
      },
    ),

    createTool(
      'select_dropdown_option',
      'select_dropdown_option',
      'Select dropdown option for interactive element index by the text of the option you want to select',
      Type.Object({
        intent: optionalIntent,
        index: Type.Number({ description: 'index of the dropdown element' }),
        text: Type.String({ description: 'text of the option' }),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        void params.intent;
        const page = await context.browserContext.getCurrentPage();
        await page.selectDropdownOption(params.index, params.text);
        const msg = t('act_selectDropdownOption_ok', [params.text, params.index.toString()]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'select_dropdown_option',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { index: params.index, text: params.text },
            }),
          ),
        );
      },
    ),

    createTool(
      'wait',
      'wait',
      'Wait for x seconds default 3, do NOT use this action unless user asks to wait explicitly',
      Type.Object({
        intent: optionalIntent,
        seconds: Type.Optional(Type.Number({ default: 3, description: 'amount of seconds' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const seconds = params.seconds ?? 3;
        void params.intent;
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        const msg = t('act_wait_ok', [seconds.toString()]);
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'wait',
              success: true,
              extractedContent: msg,
              includeInMemory: true,
              data: { seconds },
            }),
          ),
        );
      },
    ),

    createTool(
      'ask_user',
      'ask_user',
      'Ask the user for missing information that cannot be inferred safely, such as exact text to type or a required preference.',
      Type.Object({
        question: Type.String({ description: 'specific question for the user' }),
        reason: Type.Optional(Type.String({ description: 'why this input is required' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const message = params.reason ? `${params.question}\n\nReason: ${params.reason}` : params.question;
        context.finalAnswer = message;
        if (ctx.onDone) {
          ctx.onDone(message, false);
        }
        return buildResult(
          new ActionResult({
            toolName: 'ask_user',
            isDone: true,
            success: false,
            extractedContent: message,
            requiresUserInput: true,
            data: { question: params.question, reason: params.reason ?? null },
          }),
        );
      },
    ),

    createTool(
      'request_user_login',
      'request_user_login',
      'Pause when a site requires authentication. Ask the user to sign in manually, then continue in a follow-up after they are signed in.',
      Type.Object({
        reason: Type.Optional(Type.String({ description: 'brief description of the login gate' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const message = params.reason
          ? `Please sign in manually so I can continue. ${params.reason}`
          : 'Please sign in manually so I can continue.';
        context.finalAnswer = message;
        if (ctx.onDone) {
          ctx.onDone(message, false);
        }
        return buildResult(
          await resultWithCurrentUrl(
            context,
            new ActionResult({
              toolName: 'request_user_login',
              isDone: true,
              success: false,
              extractedContent: message,
              requiresUserInput: true,
              data: { reason: params.reason ?? null },
            }),
          ),
        );
      },
    ),
  ];
}
