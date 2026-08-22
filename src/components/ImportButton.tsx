import { Button } from "@lottiefiles/creator-plugins-ui";
import { Upload } from "lucide-react";
import { useRef } from "react";

export interface ImportButtonProps {
  onFile: (file: File) => void;
}

export function ImportButton({ onFile }: ImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="press key key-outline"
        onClick={() => inputRef.current?.click()}
        data-testid="import-button"
      >
        <Upload className="size-3.5!" strokeWidth={2.5} aria-hidden />
        Import
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}
