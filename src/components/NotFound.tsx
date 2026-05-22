import { Link } from "@tanstack/react-router";
import * as React from "react";
import { motion } from "framer-motion";
import { Home, ArrowLeft } from "lucide-react";

export function NotFound({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] p-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-5"
      >
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
          className="text-8xl font-black text-gradient"
        >
          404
        </motion.div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Page Not Found</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {children || "The page you are looking for doesn't exist or has been moved."}
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="pt-2"
        >
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition-all bg-primary text-white rounded-xl hover:bg-primary/90 shadow-sm shadow-primary/20"
          >
            <Home className="h-4 w-4" />
            Go back Home
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
