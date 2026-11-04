/** How a car is called in the app: its make and model (Zeekr 001), or its name (the plate) when the model is unknown. */
export const carLabel = (c: { name: string; model?: string | null }) => c.model?.trim() || c.name
