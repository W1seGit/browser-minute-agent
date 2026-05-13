export interface TraceToolCall {
  toolName: string;
  args?: unknown;
  ok: boolean;
  resultText?: string;
  currentUrl?: string | null;
  pageChanged?: boolean;
  newTabOpened?: boolean;
  requiresUserInput?: boolean;
}

export interface BrowserTaskEvalCase {
  id: string;
  task: string;
  successSignals: string[];
  maxToolCalls: number;
  requiredTools?: string[];
  forbiddenTools?: string[];
}

export interface TraceEvalResult {
  caseId: string;
  passed: boolean;
  score: number;
  findings: string[];
  toolCallCount: number;
}

export const browserTaskEvalCases: BrowserTaskEvalCase[] = [
  {
    id: 'search_extract_answer',
    task: 'Search for the current price of a public product and answer with the source URL.',
    successSignals: ['uses search', 'extracts source content', 'final answer includes URL'],
    maxToolCalls: 8,
    requiredTools: ['search_google', 'extract_content', 'done'],
  },
  {
    id: 'direct_url_observe',
    task: 'Open a provided URL and report its page title.',
    successSignals: ['opens URL', 'observes page state', 'answers title'],
    maxToolCalls: 5,
    requiredTools: ['go_to_url', 'observe', 'done'],
  },
  {
    id: 'multi_field_form_fill',
    task: 'Fill three visible form fields with provided values.',
    successSignals: ['uses batched form fill', 'does not click/type every field one by one'],
    maxToolCalls: 5,
    requiredTools: ['fill_form_fields'],
  },
  {
    id: 'missing_text_clarification',
    task: 'Type into the input without specifying the text.',
    successSignals: ['asks user for exact text', 'does not guess text'],
    maxToolCalls: 2,
    requiredTools: ['ask_user'],
    forbiddenTools: ['input_text'],
  },
  {
    id: 'login_gate',
    task: 'Continue a task on a page that asks the user to sign in.',
    successSignals: ['requests manual login', 'does not enter credentials'],
    maxToolCalls: 3,
    requiredTools: ['request_user_login'],
    forbiddenTools: ['input_text', 'fill_form_fields'],
  },
  {
    id: 'dropdown_select',
    task: 'Choose a provided option from a visible native dropdown.',
    successSignals: ['reads dropdown options', 'selects exact option text'],
    maxToolCalls: 5,
    requiredTools: ['get_dropdown_options', 'select_dropdown_option'],
  },
  {
    id: 'scroll_research',
    task: 'Collect three items from a long page by scrolling.',
    successSignals: ['extracts or caches findings before scroll', 'uses one-page scrolls'],
    maxToolCalls: 12,
    requiredTools: ['scroll'],
  },
  {
    id: 'link_extraction',
    task: 'List all relevant links from the current page.',
    successSignals: ['uses deterministic link extraction', 'does not invent URLs'],
    maxToolCalls: 4,
    requiredTools: ['extract_content'],
  },
  {
    id: 'table_extraction',
    task: 'Extract rows from a page table.',
    successSignals: ['uses table extraction', 'preserves row structure'],
    maxToolCalls: 4,
    requiredTools: ['extract_content'],
  },
  {
    id: 'terminal_entry',
    task: 'Run a provided command in a focused terminal.',
    successSignals: ['clicks terminal', 'types exact command', 'presses Enter'],
    maxToolCalls: 5,
    requiredTools: ['click_element', 'input_text', 'send_keys'],
  },
  {
    id: 'new_tab_research',
    task: 'Research something without losing the current tab.',
    successSignals: ['opens a new tab', 'returns answer with source'],
    maxToolCalls: 9,
    requiredTools: ['open_tab', 'extract_content'],
  },
  {
    id: 'tab_switch',
    task: 'Switch to an existing tab and summarize it.',
    successSignals: ['switches tab', 'observes or extracts content'],
    maxToolCalls: 5,
    requiredTools: ['switch_tab'],
  },
  {
    id: 'stale_page_reload',
    task: 'Recover from a stale or partially loaded page.',
    successSignals: ['reloads only when needed', 'observes after reload'],
    maxToolCalls: 5,
    requiredTools: ['reload', 'observe'],
  },
  {
    id: 'click_then_wait_state',
    task: 'Click a button that updates the page and continue from the new state.',
    successSignals: ['does not repeat successful click', 'observes changed state'],
    maxToolCalls: 6,
    requiredTools: ['click_element'],
  },
  {
    id: 'text_search_on_page',
    task: 'Find a specific visible phrase lower on the page.',
    successSignals: ['uses scroll_to_text', 'does not jump blindly'],
    maxToolCalls: 4,
    requiredTools: ['scroll_to_text'],
  },
  {
    id: 'cache_before_scroll',
    task: 'Gather visible findings before moving down a long page.',
    successSignals: ['caches useful findings before scrolling'],
    maxToolCalls: 8,
    requiredTools: ['cache_content', 'scroll'],
  },
  {
    id: 'close_extra_tab',
    task: 'Close an unwanted tab and continue in the remaining tab.',
    successSignals: ['closes the specified tab', 'continues with current state'],
    maxToolCalls: 5,
    requiredTools: ['close_tab'],
  },
  {
    id: 'keyboard_shortcut',
    task: 'Use a provided keyboard shortcut on the page.',
    successSignals: ['uses send_keys for shortcut', 'does not type shortcut as text'],
    maxToolCalls: 3,
    requiredTools: ['send_keys'],
    forbiddenTools: ['input_text'],
  },
  {
    id: 'readability_summary',
    task: 'Summarize an article page.',
    successSignals: ['extracts readability text', 'summarizes from extracted content'],
    maxToolCalls: 5,
    requiredTools: ['extract_content'],
  },
  {
    id: 'no_unnecessary_wait',
    task: 'Complete a simple page observation task.',
    successSignals: ['avoids wait unless needed'],
    maxToolCalls: 4,
    forbiddenTools: ['wait'],
  },
];

export function evaluateToolTrace(testCase: BrowserTaskEvalCase, trace: TraceToolCall[]): TraceEvalResult {
  const findings: string[] = [];
  const toolNames = trace.map(call => call.toolName);

  if (trace.length > testCase.maxToolCalls) {
    findings.push(`Too many tool calls: ${trace.length}/${testCase.maxToolCalls}`);
  }

  for (const requiredTool of testCase.requiredTools ?? []) {
    if (!toolNames.includes(requiredTool)) {
      findings.push(`Missing required tool: ${requiredTool}`);
    }
  }

  for (const forbiddenTool of testCase.forbiddenTools ?? []) {
    if (toolNames.includes(forbiddenTool)) {
      findings.push(`Used forbidden tool: ${forbiddenTool}`);
    }
  }

  const repeatedCalls = trace.filter((call, index) => {
    const previous = trace[index - 1];
    return previous?.toolName === call.toolName && safeCompareArgs(previous.args, call.args);
  });
  if (repeatedCalls.length > 0) {
    findings.push(`Repeated identical consecutive tool calls: ${repeatedCalls.length}`);
  }

  const failedCalls = trace.filter(call => !call.ok);
  if (failedCalls.length > 0) {
    findings.push(`Failed tool calls: ${failedCalls.map(call => call.toolName).join(', ')}`);
  }

  const passed = findings.length === 0;
  const penalties = findings.length + Math.max(0, trace.length - testCase.maxToolCalls);
  return {
    caseId: testCase.id,
    passed,
    score: Math.max(0, 1 - penalties * 0.15),
    findings,
    toolCallCount: trace.length,
  };
}

function safeCompareArgs(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
