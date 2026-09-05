export function PreciseHitIcon() {
  return (
    <svg
      viewBox="0 0 120 120"
      width="72"
      height="72"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="precise-dashHatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--editor-accent)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="1"
          />
        </pattern>
        <clipPath id="precise-circleClip">
          <circle cx="60" cy="60" r="52" />
        </clipPath>
      </defs>
      {/* hatched circle — only ellipse is active, corners dead */}
      <g clipPath="url(#precise-circleClip)">
        <rect
          x="5"
          y="5"
          width="110"
          height="110"
          fill="url(#precise-dashHatch)"
        />
      </g>
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke="var(--editor-accent)"
        strokeWidth="3"
      />
      {/* bounding box — faint, dead corners */}
      <rect
        x="5"
        y="5"
        width="110"
        height="110"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.68"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function ForgivingHitIcon() {
  return (
    <svg
      viewBox="0 0 120 120"
      width="72"
      height="72"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="forgiving-dashHatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--editor-accent)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="1"
          />
        </pattern>
      </defs>
      {/* hatched square — full box active, corners count */}
      <rect
        x="5"
        y="5"
        width="110"
        height="110"
        fill="url(#forgiving-dashHatch)"
      />
      <rect
        x="5"
        y="5"
        width="110"
        height="110"
        fill="none"
        stroke="var(--editor-accent)"
        strokeWidth="2"
      />
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.7"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function HitzoneAddIcon() {
  return (
    <svg
      viewBox="0 0 136 84"
      width="84"
      height="52"
      className="shrink-0"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="hitzone-parent-hatch"
          width="9"
          height="9"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke="var(--editor-accent)"
            strokeWidth="2.6"
            strokeDasharray="3.2,3.2"
            strokeOpacity="1"
          />
        </pattern>
        <clipPath id="hitzone-parent-clip">
          <circle cx="42" cy="42" r="40" />
        </clipPath>
      </defs>
      {/* parent — hatched circle, accent — ~1.7x larger */}
      <g clipPath="url(#hitzone-parent-clip)">
        <rect
          x="2"
          y="2"
          width="80"
          height="80"
          fill="url(#hitzone-parent-hatch)"
        />
      </g>
      <circle
        cx="42"
        cy="42"
        r="40"
        fill="none"
        stroke="var(--editor-accent)"
        strokeWidth="2.4"
      />
      {/* ghost — hatched square (full), yellow dashed */}
      <rect
        x="90"
        y="20"
        width="40"
        height="40"
        fill="url(#hitzone-parent-hatch)"
        stroke="rgb(250 204 21)"
        strokeOpacity="1"
        strokeWidth="1.2"
        strokeDasharray="7 3"
        rx="1"
      />
      <circle
        cx="110"
        cy="40"
        r="17.5"
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.18"
        strokeWidth="1.2"
        strokeDasharray="3 3"
      />
      {/* plus badge */}
      <g transform="translate(123 57)">
        <circle
          r="13"
          fill="var(--editor-accent)"
          stroke="var(--card)"
          strokeWidth="2"
        />
        <path
          d="M -5.2 0 H 5.2 M 0 -5.2 V 5.2"
          stroke="white"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
