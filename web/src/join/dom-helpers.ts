export function textField(
  labelText: string,
  id: string,
  value: string,
  placeholder: string,
): { wrapper: HTMLDivElement; input: HTMLInputElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'grid gap-1.5';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  label.className = 'text-foreground text-[0.8rem] font-medium leading-none';
  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('autocomplete', id === 'code' ? 'off' : 'nickname');
  const baseInput =
    'flex h-10 w-full rounded-[calc(var(--radius)-2px)] border border-input bg-transparent px-3 text-[0.9rem] text-foreground placeholder:text-muted-foreground outline-none focus-visible:border-ring focus:border-ring focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--ring)_50%,transparent)] disabled:opacity-50 [@media(max-height:560px)]:h-[2.35rem]';
  const codeExtra =
    ' font-mono text-base tabular-nums tracking-[0.22em] [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:text-[0.95rem] [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:tracking-[0.18em]';
  input.className = id === 'code' ? baseInput + codeExtra : baseInput;
  wrapper.append(label, input);
  return { wrapper, input };
}

export function checkboxField(
  id: string,
  labelText: string,
  checked: boolean,
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = document.createElement('label');
  wrapper.className =
    'flex items-center gap-2.5 text-foreground text-[0.85rem] font-normal cursor-pointer select-none [@media(orientation:landscape)_and_(max-height:500px)_and_(max-width:699px)]:text-[0.8rem]';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.className = 'size-4 rounded border-input accent-primary shrink-0';
  const text = document.createElement('span');
  text.textContent = labelText;
  wrapper.append(input, text);
  return { wrapper, input };
}

export function showError(element: HTMLElement, message: string): void {
  element.hidden = false;
  element.textContent = message;
}

export function updateCapabilityMessage(
  element: HTMLElement,
  status: { wakeLock: boolean; messages: string[] },
): void {
  const messages = [...status.messages];
  if (!status.wakeLock && !messages.includes('Screen wake lock unavailable.'))
    messages.push('Screen wake lock unavailable.');
  element.textContent = messages.join(' ');
}
