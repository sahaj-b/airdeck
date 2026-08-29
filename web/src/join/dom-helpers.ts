export function textField(
  labelText: string,
  id: string,
  value: string,
  placeholder: string,
): { wrapper: HTMLDivElement; input: HTMLInputElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'join-field';
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('autocomplete', id === 'code' ? 'off' : 'nickname');
  wrapper.append(label, input);
  return { wrapper, input };
}

export function checkboxField(
  id: string,
  labelText: string,
  checked: boolean,
): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'join-preference';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  const text = document.createElement('span');
  text.textContent = labelText;
  wrapper.append(input, text);
  return { wrapper, input };
}

function settingsRow(labelText: string, value: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  const label = document.createElement('span');
  label.textContent = labelText;
  row.append(label, value);
  return row;
}

export function showError(element: HTMLElement, message: string): void {
  element.hidden = false;
  element.textContent = message;
}

function formatVibration(ms: number): string {
  return ms > 0 ? `${ms} ms` : 'Off';
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
