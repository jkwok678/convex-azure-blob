import "./App.css";
import { useAction, useQuery } from "convex/react";
import { useUploadFile } from "convex-azure-blob/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import type { ChangeEvent } from "react";
import { api } from "../convex/_generated/api";

function formatSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return error instanceof Error ? error.message : String(error);
}

type ErrorProps = {
  /** Shows an error, or clears it when passed null. */
  setError: (error: unknown) => void;
};

function UploadButton({ setError }: ErrorProps) {
  const uploadFile = useUploadFile(api.example);
  const [uploading, setUploading] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadFile(file);
    } catch (error) {
      setError(error);
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  return (
    <label className="upload">
      {uploading ? "Uploading…" : "Upload an image"}
      <input
        type="file"
        accept="image/*"
        disabled={uploading}
        onChange={handleFile}
      />
    </label>
  );
}

function ImageList({ setError }: ErrorProps) {
  const images = useQuery(api.example.listImages);
  const deleteImage = useAction(api.example.deleteImage);

  function handleDelete(key: string) {
    setError(null);
    deleteImage({ key }).catch(setError);
  }

  if (images === undefined) return <p>Loading…</p>;
  if (images.length === 0) return <p>No images yet.</p>;
  return (
    <ul className="images">
      {images.map((image) => (
        <li key={image.key}>
          <img src={image.url} alt="" />
          <span>{formatSize(image.size)}</span>
          <button onClick={() => handleDelete(image.key)}>Delete</button>
        </li>
      ))}
    </ul>
  );
}

function App() {
  const [error, setErrorMessage] = useState<string | null>(null);
  const setError = (e: unknown) =>
    setErrorMessage(e === null ? null : errorMessage(e));

  return (
    <>
      <h1>Convex Azure Blob</h1>
      <div className="card">
        <UploadButton setError={setError} />
        {error && <p className="error">{error}</p>}
        <ImageList setError={setError} />
      </div>
    </>
  );
}

export default App;
