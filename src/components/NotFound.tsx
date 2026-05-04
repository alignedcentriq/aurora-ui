import { Link } from '@tanstack/react-router'
import * as React from 'react'

export function NotFound({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
      <div className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">404 - Page Not Found</h2>
        <p className="text-muted-foreground">
          {children || "The page you are looking for doesn't exist or has been moved."}
        </p>
        <div className="pt-4">
          <Link
            to="/"
            className="px-4 py-2 text-sm font-medium transition-colors bg-primary text-white rounded-lg hover:bg-primary/90"
          >
            Go back Home
          </Link>
        </div>
      </div>
    </div>
  )
}
