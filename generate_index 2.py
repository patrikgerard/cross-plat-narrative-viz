import json
import os
from pathlib import Path
from datetime import datetime

# Narrative mapping based on your research
NARRATIVE_DESCRIPTIONS = {
    173: "Harris staff exodus / toxic office",
    1111: "Harris staff exodus / toxic office echo",
    3019: "SAVE Act / foreign voters / election integrity",
    5499: "Project 2025 / Heritage agenda / jobs reframe",
    6536: "ActBlue / donation fraud",
    1674: "Wuhan lab + bioweapons / U.S.–China collab",
    7598: "Illegal-immigrant crime surge / border panic",
    2550: "Deep state / purge government / drain the swamp",
    7753: "Purge the government / deep-state rhetoric redux",
    681: "Child sex-trafficking / moral panic",
    685: "Child sex-trafficking / Save Our Children tie-in",
    1065: "Child sex-trafficking / 'save the children' surge",
    8614: "Child sex-trafficking / elite rings / Hollywood panic",
    7158: "FEMA aid mishandling / Helene storm response",
    4107: "Trump winning / poll momentum meta-narrative",
    1158: "Russia disinformation / collusion flip",
}

def generate_index_from_cluster_files(data_dir="public/data"):
    """
    Automatically generate index.json from existing cluster_*.json files
    with narrative descriptions when available
    """
    data_path = Path(data_dir)
    
    if not data_path.exists():
        print(f"❌ Directory not found: {data_dir}")
        return
    
    # Find all cluster files
    cluster_files = sorted(data_path.glob("cluster_*.json"))
    
    if not cluster_files:
        print(f"❌ No cluster_*.json files found in {data_dir}")
        return
    
    print(f"📁 Found {len(cluster_files)} cluster files")
    
    clusters = []
    total_size = 0
    narratives_found = 0
    
    for cluster_file in cluster_files:
        print(f"  📄 Processing {cluster_file.name}...")
        
        try:
            # Load cluster data
            with open(cluster_file, 'r') as f:
                cluster_data = json.load(f)
            
            # Extract metadata
            metadata = cluster_data.get('metadata', {})
            
            # Get file size
            file_size_mb = cluster_file.stat().st_size / (1024 * 1024)
            total_size += file_size_mb
            
            # Count communities and frames
            num_communities = len(cluster_data.get('communities', {}))
            num_frames = len(cluster_data.get('timeline', []))
            
            # Get date range
            start_date = metadata.get('start_date', 'Unknown')
            end_date = metadata.get('end_date', 'Unknown')
            
            if start_date != 'Unknown' and end_date != 'Unknown':
                start_str = datetime.fromisoformat(start_date).strftime('%Y-%m-%d')
                end_str = datetime.fromisoformat(end_date).strftime('%Y-%m-%d')
                date_range = f"{start_str} to {end_str}"
            else:
                date_range = "Unknown"
            
            # Get total posts
            total_posts = metadata.get('total_posts', 0)
            cluster_id = metadata.get('cluster_id', 'Unknown')
            
            # Check if we have a narrative description for this cluster
            narrative = NARRATIVE_DESCRIPTIONS.get(cluster_id)
            if narrative:
                narratives_found += 1
                print(f"    📖 Found narrative: {narrative}")
            
            cluster_info = {
                'cluster_id': cluster_id,
                'file': cluster_file.name,
                'size_mb': round(file_size_mb, 2),
                'communities': num_communities,
                'edges': len(cluster_data.get('edges', [])),
                'frames': num_frames,
                'date_range': date_range,
                'total_posts': total_posts
            }
            
            # Add narrative if available
            if narrative:
                cluster_info['narrative'] = narrative
            
            clusters.append(cluster_info)
            print(f"    ✓ Cluster {cluster_id}: {num_communities} communities, {num_frames} frames")
            
        except Exception as e:
            print(f"    ⚠️  Error processing {cluster_file.name}: {e}")
            continue
    
    if not clusters:
        print("❌ No valid cluster files processed")
        return
    
    # Sort by cluster_id
    clusters.sort(key=lambda x: x['cluster_id'])
    
    # Create index
    index = {
        'export_date': datetime.now().isoformat(),
        'num_clusters': len(clusters),
        'total_size_mb': round(total_size, 2),
        'narratives_identified': narratives_found,
        'clusters': clusters
    }
    
    # Write index.json
    index_path = data_path / 'index.json'
    with open(index_path, 'w') as f:
        json.dump(index, f, indent=2)
    
    print(f"\n✅ Created {index_path}")
    print(f"   📊 {len(clusters)} clusters")
    print(f"   📖 {narratives_found} with narrative descriptions")
    print(f"   💾 {round(total_size, 2)} MB total")
    print(f"\n📋 Summary:")
    for cluster in clusters:
        narrative_str = f" — {cluster['narrative']}" if 'narrative' in cluster else ""
        print(f"   • Cluster {cluster['cluster_id']}: {cluster['communities']} communities, {cluster['total_posts']} posts{narrative_str}")
    
    return index


# Run it
if __name__ == "__main__":
    index = generate_index_from_cluster_files("./data")