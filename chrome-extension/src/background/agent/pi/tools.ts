import { Type, type TSchema, type Static } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { ActionResult, type AgentContext } from '../types';
import { ExecutionState, Actors } from '../event/types';
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
      'Complete the task and provide the final answer',
      Type.Object({
        text: Type.String({ description: 'final answer or summary' }),
        success: Type.Optional(Type.Boolean({ default: true })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        context.finalAnswer = params.text;
        await context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, params.text);
        const result = new ActionResult({ isDone: true, success: params.success, extractedContent: params.text });
        if (ctx.onDone) {
          ctx.onDone(params.text, params.success ?? true);
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
        const intent = params.intent || t('act_searchGoogle_start', [params.query]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        await context.browserContext.navigateTo(`https://www.google.com/search?q=${encodeURIComponent(params.query)}`);
        const msg = t('act_searchGoogle_ok', [params.query]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_goToUrl_start', [params.url]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        await context.browserContext.navigateTo(params.url);
        const msg = t('act_goToUrl_ok', [params.url]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'go_back',
      'go_back',
      'Go back to the previous page',
      Type.Object({ intent: optionalIntent }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_goBack_start');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        await page.goBack();
        const msg = t('act_goBack_ok');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'click_element',
      'click_element',
      'Click element by index',
      Type.Object({
        intent: optionalIntent,
        index: Type.Number({ description: 'index of the element' }),
        xpath: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'xpath of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_click_start', [params.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
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
        await page.waitForPageAndFramesLoad();
        const newTabIds = await context.browserContext.getAllTabIds();
        if (newTabIds.size > initialTabIds.size) {
          msg += '\n\nNew tab opened. Focused on new tab.';
          const newTabs = Array.from(newTabIds);
          await context.browserContext.switchTab(newTabs[newTabs.length - 1]);
        }
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'input_text',
      'input_text',
      'Input text into an interactive input element',
      Type.Object({
        intent: optionalIntent,
        index: Type.Number({ description: 'index of the element' }),
        text: Type.String({ description: 'text to input' }),
        xpath: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: 'xpath of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_inputText_start', [params.text, params.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = state?.selectorMap.get(params.index);
        if (!elementNode) {
          throw new Error(t('act_errors_elementNotExist', [params.index.toString()]));
        }
        await page.inputTextElementNode(context.options.useVision, elementNode, params.text);
        const msg = t('act_inputText_ok', [params.text, params.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_switchTab_start', [params.tab_id.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        await context.browserContext.switchTab(params.tab_id);
        const msg = t('act_switchTab_ok', [params.tab_id.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_openTab_start', [params.url]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        await context.browserContext.openTab(params.url);
        const msg = t('act_openTab_ok', [params.url]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_closeTab_start', [params.tab_id.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        await context.browserContext.closeTab(params.tab_id);
        const msg = t('act_closeTab_ok', [params.tab_id.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_cache_start');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const msg = t('act_cache_ok', [params.content]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: params.content, includeInMemory: true }));
      },
    ),

    createTool(
      'scroll_to_percent',
      'scroll_to_percent',
      'Scrolls to a particular vertical percentage of the document or an element. If no index of element is specified, scroll the whole document.',
      Type.Object({
        intent: optionalIntent,
        yPercent: Type.Number({ description: 'percentage to scroll to - min 0, max 100; 0 is top, 100 is bottom' }),
        index: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: 'index of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_scrollToPercent_start', [params.yPercent.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = params.index != null ? state?.selectorMap.get(params.index) : undefined;
        await page.scrollToPercent(params.yPercent, elementNode);
        const msg = t('act_scrollToPercent_ok', [params.yPercent.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'scroll_to_top',
      'scroll_to_top',
      'Scroll the document in the window or an element to the top',
      Type.Object({
        intent: optionalIntent,
        index: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: 'index of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_scrollToTop_start');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = params.index != null ? state?.selectorMap.get(params.index) : undefined;
        await page.scrollToPercent(0, elementNode);
        const msg = t('act_scrollToTop_ok');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'scroll_to_bottom',
      'scroll_to_bottom',
      'Scroll the document in the window or an element to the bottom',
      Type.Object({
        intent: optionalIntent,
        index: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: 'index of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_scrollToBottom_start');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = params.index != null ? state?.selectorMap.get(params.index) : undefined;
        await page.scrollToPercent(100, elementNode);
        const msg = t('act_scrollToBottom_ok');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'previous_page',
      'previous_page',
      'Scroll the document in the window or an element to the previous page. If no index is specified, scroll the whole document.',
      Type.Object({
        intent: optionalIntent,
        index: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: 'index of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_previousPage_start');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = params.index != null ? state?.selectorMap.get(params.index) : undefined;
        await page.scrollToPreviousPage(elementNode);
        const msg = t('act_previousPage_ok');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),

    createTool(
      'next_page',
      'next_page',
      'Scroll the document in the window or an element to the next page. If no index is specified, scroll the whole document.',
      Type.Object({
        intent: optionalIntent,
        index: Type.Optional(Type.Union([Type.Number(), Type.Null()], { description: 'index of the element' })),
      }),
      async (_toolCallId, params): Promise<AgentToolResult<unknown>> => {
        const intent = params.intent || t('act_nextPage_start');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const state = await page.getState();
        const elementNode = params.index != null ? state?.selectorMap.get(params.index) : undefined;
        await page.scrollToNextPage(elementNode);
        const msg = t('act_nextPage_ok');
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_scrollToText_start', [params.text]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        await page.scrollToText(params.text, params.nth ?? 1);
        const msg = t('act_scrollToText_ok', [params.text]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_sendKeys_start', [params.keys]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        await page.sendKeys(params.keys);
        const msg = t('act_sendKeys_ok', [params.keys]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_getDropdownOptions_start', [params.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        const options = await page.getDropdownOptions(params.index);
        const msg = `Dropdown options: ${JSON.stringify(options)}`;
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_selectDropdownOption_start', [params.text, params.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        const page = await context.browserContext.getCurrentPage();
        await page.selectDropdownOption(params.index, params.text);
        const msg = t('act_selectDropdownOption_ok', [params.text, params.index.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
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
        const intent = params.intent || t('act_wait_start', [seconds.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_START, intent);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        const msg = t('act_wait_ok', [seconds.toString()]);
        context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_OK, msg);
        return buildResult(new ActionResult({ extractedContent: msg, includeInMemory: true }));
      },
    ),
  ];
}
