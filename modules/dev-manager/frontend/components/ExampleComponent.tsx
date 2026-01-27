import React from "react";

export interface ExampleComponentProps {
  title: string;
  subtitle?: string;
}

export default function ExampleComponent({ title, subtitle }: ExampleComponentProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-medium text-gray-900">{title}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

