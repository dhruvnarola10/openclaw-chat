// Floating autocomplete shown above the chat input when the user types `/`.

export default function SlashPopup({ results, idx, onSelect, onHover }) {
  return (
    <div className="slash-popup">
      {results.map((item, i) => (
        <button
          key={item.cmd}
          className={`slash-item${i === idx ? ' active' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="slash-cmd">{item.cmd}</span>
          <span className="slash-desc">{item.desc}</span>
          <span className="slash-cat">{item.cat}</span>
        </button>
      ))}
      <div className="slash-footer">
        <span>↑↓ navigate</span>
        <span>↵ / Tab select</span>
        <span>Esc dismiss</span>
      </div>
    </div>
  );
}
