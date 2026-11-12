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

function App() {
  const images = useQuery(api.example.listImages);
  const uploadFile = useUploadFile(api.example);
  const deleteImage = useAction(api.example.deleteImage);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadFile(file);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  async function handleDelete(key: string) {
    setError(null);
    try {
      await deleteImage({ key });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <h1>Convex Azure Blob</h1>
      <div className="card">
        <label className="upload">
          {uploading ? "Uploading…" : "Upload an image"}
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={handleFile}
          />
        </label>
        {error && <p className="error">{error}</p>}
        {images === undefined && <p>Loading…</p>}
        {images?.length === 0 && <p>No images yet.</p>}
        <ul className="images">
          {images?.map((image) => (
            <li key={image.key}>
              <img src={image.url} alt="" />
              <span>{formatSize(image.size)}</span>
              <button onClick={() => handleDelete(image.key)}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export default App;
