/** One repository, served to many agents. Keep in sync with public/brand/symbol.svg. */
export function BrandSymbol(props: { readonly className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
      <path
        d="M10 16h4.5c3.5 0 3-6 7.5-6M14.5 16c3.5 0 3 6 7.5 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="16" r="3" fill="currentColor" />
      <circle cx="22.4" cy="10" r="2.5" fill="currentColor" />
      <circle cx="22.4" cy="22" r="2.5" fill="currentColor" />
    </svg>
  );
}
