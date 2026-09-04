import './preview.css';

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 14.5 12 8l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SkinPreview({ id }: { id: string }) {
  return (
    <span data-skin={id} className="skin-preview" aria-hidden="true">
      <span className="controller-frame skin-preview-frame">
        <span
          className="controller-control control-joystick skin-preview-stick"
          data-shape="round"
        />
        <span
          className="controller-control skin-preview-chip"
          data-shape="round"
          data-command="south"
        >
          A
        </span>
        <span
          className="controller-control controller-dpad skin-preview-dpad"
          data-direction="up"
        >
          <span className="dpad-direction dpad-up">
            <Chevron />
          </span>
          <span className="dpad-direction dpad-right">
            <Chevron />
          </span>
          <span className="dpad-direction dpad-down">
            <Chevron />
          </span>
          <span className="dpad-direction dpad-left">
            <Chevron />
          </span>
        </span>
      </span>
    </span>
  );
}
