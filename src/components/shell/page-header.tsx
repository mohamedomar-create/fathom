export function PageHeader({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="-mx-4 mb-6 bg-band px-4 py-5 sm:-mx-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] font-normal leading-tight sm:text-[32px]">{title}</h1>
        {right}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
