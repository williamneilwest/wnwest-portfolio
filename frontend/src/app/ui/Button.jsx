export function Button({ children, className = '', variant = 'primary', ...props }) {
  const variantClass = variant === 'secondary' ? 'ui-button--secondary' : 'ui-button--primary';
  const classes = ['ui-button', variantClass, className].filter(Boolean).join(' ');

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
