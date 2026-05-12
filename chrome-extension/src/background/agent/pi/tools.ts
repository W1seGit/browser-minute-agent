import { Type, type TSchema, type Static } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { ActionResult, type AgentContext } from '../types';
import { createLogger } from '@src/background/log';
import { t } from '@extension/i18n';

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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
          return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
        }
        const initialTabIds = await context.browserContext.getAllTabIds();
        await page.clickElementNode(context.options.useVision, elementNode);
        let msg = t('act_click_ok', [params.index.toString(), elementNode.getAllTextTillNextClickableElement(2)]);
        msg += '\n\nClick succeeded. For editor/input/terminal targets, use input_text next.';
        await page.waitForPageAndFramesLoad();
        const newTabIds = await context.browserContext.getAllTabIds();
        if (newTabIds.size > initialTabIds.size) {
          msg += '\n\nNew tab opened. Focused on new tab.';
          const newTabs = Array.from(newTabIds);
          await context.browserContext.switchTab(newTabs[newTabs.length - 1]);
        }
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: params.content, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
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
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),
  ];
}
