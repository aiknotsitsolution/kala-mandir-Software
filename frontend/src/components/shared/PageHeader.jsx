import { ChevronRight, HomeIcon } from "lucide-react";
import { Link } from "react-router-dom";
export function PageHeader({ title, description, actions, breadcrumbs, icon, }) {
    return (<div className="space-y-4">
      {breadcrumbs && breadcrumbs.length > 0 ? (<nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link to="/" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
            <HomeIcon className="size-3.5"/>
            Dashboard
          </Link>
          {breadcrumbs.map((crumb) => (<span key={crumb.label} className="flex items-center gap-1.5">
              <ChevronRight className="size-3"/>
              {crumb.to ? (<Link to={crumb.to} className="transition-colors hover:text-foreground">
                  {crumb.label}
                </Link>) : (<span className="text-foreground">{crumb.label}</span>)}
            </span>))}
        </nav>) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          {icon ? (<div className="mb-1 text-km-gold" aria-hidden="true">{icon}</div>) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
          {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>);
}
