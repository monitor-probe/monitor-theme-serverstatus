import * as React from "react"

import { cn } from "@/lib/utils"

// The two shapes this theme renders: the filled button behind the retry on a
// failed load, and the ghost icon button in the corner toolbox. A variant nothing
// renders is dead styling, and `asChild` would carry a radix-ui dependency for a
// delegation no caller asks for.
const VARIANTS = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
}

const SIZES = { default: "h-9 px-4 py-2 has-[>svg]:px-3", icon: "size-9" }

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> & { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES }) {
  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}

export { Button }
