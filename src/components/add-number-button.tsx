"use client";

import { isRateLimitError } from "@convex-dev/rate-limiter";
import { Button } from "@ui-sdk/react/button";
import { useMutation } from "convex/react";
import { type ComponentProps, useState } from "react";
import { api } from "@/convex/_generated/api";

function errorMessage(error: unknown) {
  if (isRateLimitError(error)) {
    const seconds = Math.ceil((error.data.retryAfter ?? 1000) / 1000);
    return `Too many numbers at once. Try again in ${seconds} s.`;
  }
  return "Couldn't add a number. Try again.";
}

export default function AddNumberButton({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "children" | "className"> & {
  className?: string;
}) {
  const addNumber = useMutation(api.myFunctions.addNumber);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className={`flex flex-col gap-1 ${className ?? "items-start"}`}>
      <Button
        data-variant="solid"
        pendingAnnouncement="Adding a number"
        {...props}
        onClick={async () => {
          try {
            await addNumber({ value: Math.floor(Math.random() * 10) });
            setError(null);
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
      >
        Add a random number
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {error}
      </p>
    </div>
  );
}
