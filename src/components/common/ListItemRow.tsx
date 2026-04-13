import React from "react";

interface ListItemRowProps {
  isLast?: boolean;
  children: React.ReactNode;
}

export const ListItemRow: React.FC<ListItemRowProps> = ({
  isLast,
  children,
}) => {
  return (
    <div
      className={`group flex items-center gap-4 px-5 py-4 transition-colors ${
        !isLast ? "border-b border-black/[0.06] dark:border-white/8" : ""
      } hover:bg-black/[0.02] dark:hover:bg-white/[0.04]`}
    >
      {children}
    </div>
  );
};
