import React from 'react';
import DOMPurify from 'dompurify';

interface SafeHTMLProps extends React.HTMLAttributes<HTMLDivElement> {
  html: string;
}

export const SafeHTML: React.FC<SafeHTMLProps> = ({ html, ...props }) => {
  const sanitizedHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true }, // allow standard HTML
  });

  return (
    <div
      {...props}
      dangerouslySetInnerHTML={{ __html: sanitizedHTML }}
    />
  );
};
