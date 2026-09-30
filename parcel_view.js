const coordinates = [
    { id: 1, y: 504800.46, x: 4328565.98 },
    { id: 3, y: 504788.70, x: 4328566.53 },
    { id: 5, y: 504756.21, x: 4328568.05 },
    { id: 7, y: 504755.91, x: 4328560.05 },
    { id: 10, y: 504724.52, x: 4328561.51 },
    { id: 11, y: 504721.97, x: 4328561.63 },
    { id: 12, y: 504721.38, x: 4328540.56 },
    { id: 9, y: 504725.09, x: 4328538.19 },
    { id: 8, y: 504739.03, x: 4328529.31 },
    { id: 6, y: 504756.01, x: 4328526.49 },
    { id: 4, y: 504787.25, x: 4328521.31 },
    { id: 2, y: 504799.17, x: 4328519.33 }
];

document.addEventListener('DOMContentLoaded', () => {
    populateTable();
    drawParcel();
});

function populateTable() {
    const tbody = document.getElementById('coordTableBody');
    coordinates.forEach(point => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${point.id}</td>
            <td>${point.y.toFixed(2)}</td>
            <td>${point.x.toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    });
}

function drawParcel() {
    const container = document.getElementById('parcelSvgContainer');
    
    // Calculate bounds
    const ys = coordinates.map(p => p.y);
    const xs = coordinates.map(p => p.x);
    
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    
    const width = maxY - minY;
    const height = maxX - minX;
    
    const padding = Math.max(width, height) * 0.1;
    
    // Viewbox setup
    // Note: In SVG, Y increases downwards. In surveying, X (Northing) increases upwards.
    // We'll flip X as SVG-Y and Y as SVG-X.
    const viewBox = `${minY - padding} ${minX - padding} ${width + padding * 2} ${height + padding * 2}`;
    
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.style.transform = "scaleY(-1)"; // Flip to make Northing go up
    
    // Draw polygon
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const pointsStr = coordinates.map(p => `${p.y},${p.x}`).join(' ');
    
    polygon.setAttribute("points", pointsStr);
    polygon.setAttribute("fill", "rgba(0, 242, 255, 0.1)");
    polygon.setAttribute("stroke", "#00f2ff");
    polygon.setAttribute("stroke-width", "0.5");
    polygon.setAttribute("stroke-linejoin", "round");
    
    svg.appendChild(polygon);
    
    // Draw points and labels
    coordinates.forEach(p => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", p.y);
        circle.setAttribute("cy", p.x);
        circle.setAttribute("r", "0.4");
        circle.setAttribute("fill", "#fff");
        svg.appendChild(circle);
        
        // Add label (needs special care because of scaleY(-1))
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", p.y);
        text.setAttribute("y", p.x + 1.5); // Offset
        text.setAttribute("font-size", "2");
        text.setAttribute("fill", "#94a3b8");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("transform", `scale(1, -1) translate(0, ${-2*p.x - 3})`); // Correct text orientation
        text.textContent = p.id;
        svg.appendChild(text);
    });
    
    container.innerHTML = '';
    container.appendChild(svg);
}
