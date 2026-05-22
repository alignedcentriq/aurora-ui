import { useState } from "react";
import { Car, Bike, CheckCircle2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  userEmail: string;
  onSubmitted: (message: string) => void;
}

export function ParkingForm({ userEmail, onSubmitted }: Props) {
  const [vehicleType, setVehicleType] = useState("4-Wheeler");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleNumber.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/parking/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmail,
          vehicle_type: vehicleType,
          vehicle_number: vehicleNumber.trim().toUpperCase(),
          vehicle_make: vehicleMake.trim(),
          vehicle_model: vehicleModel.trim(),
        }),
      });
      const result = await res.json();
      setSubmitted(true);
      onSubmitted(result.message || "Parking sticker request submitted.");
    } catch {
      onSubmitted("Failed to submit the request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 400, damping: 15 }}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
        </motion.div>
        Request submitted successfully.
      </motion.div>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onSubmit={handleSubmit}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Car className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Parking Sticker Request
        </span>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <span className="mb-2 block text-xs font-semibold text-muted-foreground">Vehicle Type</span>
          <div className="flex gap-2">
            {(["2-Wheeler", "4-Wheeler"] as const).map((type) => (
              <motion.button
                key={type}
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => setVehicleType(type)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-all ${
                  vehicleType === type
                    ? "border-primary bg-primary text-white shadow-sm shadow-primary/20"
                    : "border-border bg-background text-foreground hover:bg-muted"
                }`}
              >
                {type === "2-Wheeler" ? (
                  <Bike className="h-3.5 w-3.5" />
                ) : (
                  <Car className="h-3.5 w-3.5" />
                )}
                {type}
              </motion.button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            Vehicle Number <span className="text-destructive">*</span>
          </label>
          <input
            required
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            placeholder="e.g. MH12AB1234"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Make <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              value={vehicleMake}
              onChange={(e) => setVehicleMake(e.target.value)}
              placeholder="e.g. Honda"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Model <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
              placeholder="e.g. Activa"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
            />
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            disabled={submitting || !vehicleNumber.trim()}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </motion.button>
        </div>
      </div>
    </motion.form>
  );
}
