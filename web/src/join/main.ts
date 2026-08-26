import './join.css';

const root = document.querySelector<HTMLElement>('#root');
if (!root) throw new Error('join root is missing');

const heading = document.createElement('h1');
heading.textContent = 'Airdeck controller';
const message = document.createElement('p');
message.textContent =
  'The touch controller runtime is not installed in this build.';
root.append(heading, message);
