import type { ControlItem } from "../types";

type Props = {
  title: string;
  items: ControlItem[];
};

export default function ControlsColumn({ title, items }: Props) {
  return (
    <div className="msi-card msi-controls-column">
      <h3>{title}</h3>

      {items.length === 0 ? (
        <div className="msi-empty-inline">No controls returned yet.</div>
      ) : (
        <div className="msi-card-list">
          {items.map((item) => (
            <div key={item.id} className="msi-control-item">
              <div className="msi-control-row">
                <div>
                  <div className="msi-control-item-title">{item.controlName}</div>
                  <div className="msi-control-ref">{item.oshaStandard}</div>
                </div>

                <span className="msi-freq-badge">Frequency {item.frequencyScore}</span>
              </div>

              <p className="msi-control-desc">{item.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
