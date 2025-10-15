import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Info, Filter, Zap, Twitter, MessageCircle, Send, Shield, Sparkles, HelpCircle, LayoutGrid, Radio } from 'lucide-react';
import * as d3 from 'd3';

const NarrativeViz = () => {
  const [data, setData] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [showEdges, setShowEdges] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [useForceLayout, setUseForceLayout] = useState(true);
  const [cumulativeMode, setCumulativeMode] = useState(true);
  const [availableClusters, setAvailableClusters] = useState([]);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [hoveredCommunity, setHoveredCommunity] = useState(null);
  const [animationSpeed, setAnimationSpeed] = useState(100);
  const [narrativeFilter, setNarrativeFilter] = useState('all');
  const [clusterMapping, setClusterMapping] = useState({});
  const [selectedTheme, setSelectedTheme] = useState('all');
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const simulationRef = useRef(null);
  const positionsRef = useRef({});
  const clickableNodesRef = useRef([]);
  const lastActiveCommunitiesRef = useRef(null);

  // Load cluster mapping and index
  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      fetch('/data/cluster_mapping.json').then(res => {
        if (!res.ok) throw new Error('Could not load cluster_mapping.json');
        return res.json();
      }),
      fetch('/data/index.json').then(res => {
        if (!res.ok) throw new Error('Could not load index.json');
        return res.json();
      })
    ])
      .then(([mapping, index]) => {
        const mappingObj = {};
        mapping.forEach(item => {
          mappingObj[item.id] = {
            overview: item.overview,
            theme: item.theme,
            relevance: item.relevance
          };
        });
        setClusterMapping(mappingObj);

        const clusters = index.clusters || [];
        const enhancedClusters = clusters
          .map(cluster => {
            const mappingData = mappingObj[cluster.cluster_id];
            return {
              ...cluster,
              overview: mappingData?.overview,
              theme: mappingData?.theme,
              relevance: mappingData?.relevance,
              hasMappingData: !!mappingData
            };
          })
          .filter(cluster => cluster.hasMappingData);

        const relevanceOrder = ['Extremely High', 'Very High', 'High', 'Moderate-High', 'Moderate', 'Low', 'Unknown'];
        enhancedClusters.sort((a, b) => relevanceOrder.indexOf(a.relevance || 'Unknown') - relevanceOrder.indexOf(b.relevance || 'Unknown'));

        setAvailableClusters(enhancedClusters);
        if (enhancedClusters.length > 0) setSelectedCluster(enhancedClusters[0].cluster_id);
        else setError('No clusters found with descriptions in cluster_mapping.json');
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading data:', err);
        setError('Failed to load cluster data. Make sure /public/data/cluster_mapping.json and index.json exist.');
        setLoading(false);
      });
  }, []);

  // Unique themes
  const uniqueThemes = useMemo(() => {
    const themes = new Set();
    availableClusters.forEach(c => c.theme && themes.add(c.theme));
    return Array.from(themes).sort();
  }, [availableClusters]);

  // Filtered clusters
  const filteredClusters = useMemo(() => (selectedTheme === 'all' ? availableClusters : availableClusters.filter(c => c.theme === selectedTheme)), [availableClusters, selectedTheme]);

  // Load selected cluster json
  useEffect(() => {
    if (!selectedCluster) return;
    setLoading(true);
    setLoadProgress(0);
    setError(null);
    setData(null);
    setCurrentFrame(0);

    fetch(`/data/cluster_${selectedCluster}.json`)
      .then(response => {
        if (!response.ok) throw new Error(`Could not load cluster_${selectedCluster}.json`);
        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        let receivedLength = 0;
        const chunks = [];
        return reader.read().then(function processText({ done, value }) {
          if (done) {
            setLoadProgress(100);
            return new Blob(chunks);
          }
          chunks.push(value);
          receivedLength += value.length;
          if (contentLength) setLoadProgress(Math.round((receivedLength / contentLength) * 100));
          return reader.read().then(processText);
        });
      })
      .then(blob => blob.text())
      .then(text => JSON.parse(text))
      .then(clusterData => {
        setData(clusterData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading cluster data:', err);
        setError(`Failed to load cluster ${selectedCluster}. ${err.message}`);
        setLoading(false);
      });
  }, [selectedCluster]);

  // Cumulative processing
  const processedTimeline = useMemo(() => {
    if (!data || !cumulativeMode) return data?.timeline || [];
    const cumulative = [];
    const runningTotals = {};
    data.timeline.forEach(frame => {
      const newFrame = { ...frame, communities: {} };
      // carry forward
      Object.keys(runningTotals).forEach(id => (newFrame.communities[id] = { ...runningTotals[id] }));
      // add new
      Object.entries(frame.communities).forEach(([id, c]) => {
        if (!newFrame.communities[id]) newFrame.communities[id] = { posts: 0 };
        newFrame.communities[id].posts = (newFrame.communities[id].posts || 0) + (c.posts || 0);
        // carry forward per-platform if provided
        if (c.platform_counts) {
          newFrame.communities[id].platform_counts = sumCounts(newFrame.communities[id].platform_counts, c.platform_counts);
        }
        newFrame.communities[id].recently_active = c.recently_active;
      });
      // node size
      const maxPosts = Math.max(...Object.values(newFrame.communities).map(c => c.posts || 0), 1);
      Object.values(newFrame.communities).forEach(c => (c.size = Math.log1p(c.posts || 0) / Math.log1p(maxPosts)));
      // save totals for next step
      Object.entries(newFrame.communities).forEach(([id, c]) => (runningTotals[id] = { ...c }));
      cumulative.push(newFrame);
    });
    return cumulative;
  }, [data, cumulativeMode]);

  // Force layout
  useEffect(() => {
    if (!data || !useForceLayout) {
      if (simulationRef.current) simulationRef.current.stop();
      simulationRef.current = null;
      positionsRef.current = data?.layout || {};
      lastActiveCommunitiesRef.current = null;
      return;
    }
    const timeline = cumulativeMode ? processedTimeline : data.timeline;
    const frame = timeline[currentFrame];
    const activeIds = frame ? Object.keys(frame.communities) : [];
    const activeKey = activeIds.sort().join(',');
    if (lastActiveCommunitiesRef.current === activeKey && simulationRef.current) {
      simulationRef.current.alpha(0.3).restart();
      return;
    }
    lastActiveCommunitiesRef.current = activeKey;
    if (simulationRef.current) simulationRef.current.stop();

    const nodeMap = {};
    const nodes = activeIds
      .filter(id => data.layout[id])
      .map(id => {
        const prev = positionsRef.current[id];
        const node = {
          id: String(id),
          x: prev ? prev.x * 500 + 600 : (data.layout[id]?.x || 0) * 500 + 600,
          y: prev ? prev.y * 350 + 350 : (data.layout[id]?.y || 0) * 350 + 350,
          ...data.communities[id]
        };
        nodeMap[String(id)] = node;
        return node;
      });

    const links = data.edges
      .filter(e => activeIds.includes(String(e.source)) && activeIds.includes(String(e.target)))
      .map(e => ({ source: nodeMap[String(e.source)], target: nodeMap[String(e.target)], weight: e.normalized_weight }))
      .filter(l => l.source && l.target);

    if (!nodes.length) return;
    const simulation = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(links).distance(d => 80 / Math.max(d.weight, 0.1)).strength(d => d.weight * 0.8))
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(500))
      .force('center', d3.forceCenter(600, 350))
      .force('collision', d3.forceCollide().radius(40))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    simulation.on('tick', () => {
      const newPositions = {};
      nodes.forEach(n => (newPositions[n.id] = { x: (n.x - 600) / 500, y: (n.y - 350) / 350 }));
      positionsRef.current = newPositions;
    });
    simulationRef.current = simulation;
    return () => simulationRef.current && simulationRef.current.stop();
  }, [data, useForceLayout, currentFrame, cumulativeMode, processedTimeline]);

  // Animation
  useEffect(() => {
    if (!isPlaying || !data) return;
    animationRef.current = setInterval(() => {
      setCurrentFrame(prev => {
        const timeline = cumulativeMode ? processedTimeline : data.timeline;
        return prev < timeline.length - 1 ? prev + 1 : 0;
      });
    }, animationSpeed);
    return () => clearInterval(animationRef.current);
  }, [isPlaying, data, cumulativeMode, processedTimeline, animationSpeed]);

  // Canvas render
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    const timeline = cumulativeMode ? processedTimeline : data.timeline;
    const frame = timeline[currentFrame];
    if (!frame) return;

    const layout = useForceLayout ? positionsRef.current : data.layout;

    const xCoords = Object.values(layout).map(p => p.x);
    const yCoords = Object.values(layout).map(p => p.y);
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);

    const padding = 80;
    const sx = x => ((x - minX) / (maxX - minX)) * (width - 2 * padding) + padding;
    const sy = y => ((y - minY) / (maxY - minY)) * (height - 2 * padding) + padding;

    if (showEdges) {
      data.edges.forEach(edge => {
        const sp = layout[edge.source];
        const tp = layout[edge.target];
        if (!sp || !tp) return;
        const x1 = sx(sp.x);
        const y1 = sy(sp.y);
        const x2 = sx(tp.x);
        const y2 = sy(tp.y);
        const g = ctx.createLinearGradient(x1, y1, x2, y2);
        const baseAlpha = Math.min(edge.alpha * 2, 0.8);
        g.addColorStop(0, `rgba(147, 197, 253, ${baseAlpha})`);
        g.addColorStop(0.5, `rgba(196, 181, 253, ${baseAlpha * 0.8})`);
        g.addColorStop(1, `rgba(251, 191, 219, ${baseAlpha * 0.6})`);
        ctx.strokeStyle = g;
        ctx.lineWidth = Math.max(edge.linewidth * 1.5, 1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });
    }

    const clickableNodes = [];

    Object.entries(frame.communities).forEach(([id, cFrame]) => {
      const comm = data.communities[id];
      const pos = layout[id];
      if (!pos || !comm) return;
      if (filterPlatform !== 'all' && comm.dominant_platform !== filterPlatform && comm.dominant_platform !== 'mixed') return;

      const x = sx(pos.x);
      const y = sy(pos.y);
      const radius = 8 + (cFrame.size || 0) * 35;
      const alpha = cFrame.recently_active ? 0.3 : 0.1;
      clickableNodes.push({ commId: id, x, y, radius });

      const highlighted = selectedCommunity === id || hoveredCommunity === id;
      if (highlighted) {
        ctx.shadowBlur = 25;
        ctx.shadowColor = `rgb(255, 255, 255)`;
        // ctx.shadowColor = `rgb(${comm.color.r}, ${comm.color.g}, ${comm.color.b})`;
      }

      // ctx.fillStyle = `rgba(${comm.color.r}, ${comm.color.g}, ${comm.color.b}, ${highlighted ? 1.0 : alpha})`;
      ctx.fillStyle = `rgba(255, 255, 255, ${highlighted ? 0.7 : alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = highlighted ? 'rgba(255, 255, 255, 1)' : cFrame.recently_active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = highlighted ? 3 : cFrame.recently_active ? 2 : 1;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // LIVE platform wedges if we have them for this frame
      const wedges = getBestPlatformBreakdownFor(id, cFrame, comm);
      if (wedges && wedges.length > 1 && radius > 15) {
        let startAngle = 0;
        wedges.forEach(p => {
          const angle = ((p.percentage || 0) / 100) * Math.PI * 2;
          ctx.fillStyle = getPlatformColor(p.platform);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.arc(x, y, radius * 0.6, startAngle, startAngle + angle);
          ctx.closePath();
          ctx.fill();
          startAngle += angle;
        });
      }

      if (radius > 12) {
        ctx.fillStyle = 'white';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((cFrame.posts || 0).toLocaleString(), x, y);
      }
    });

    clickableNodesRef.current = clickableNodes;
  }, [data, currentFrame, showEdges, filterPlatform, selectedCommunity, hoveredCommunity, useForceLayout, cumulativeMode, processedTimeline]);

  // Canvas interactions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleClick = e => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      for (const node of clickableNodesRef.current) {
        const d = Math.hypot(x - node.x, y - node.y);
        if (d < node.radius) {
          setSelectedCommunity(node.commId);
          setIsPlaying(false);
          return;
        }
      }
      setSelectedCommunity(null);
    };
    const handleMove = e => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      let hover = null;
      for (const node of clickableNodesRef.current) {
        const d = Math.hypot(x - node.x, y - node.y);
        if (d < node.radius) {
          hover = node.commId;
          canvas.style.cursor = 'pointer';
          break;
        }
      }
      if (!hover) canvas.style.cursor = 'default';
      setHoveredCommunity(hover);
    };
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mousemove', handleMove);
    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMove);
    };
  }, [data]);

  // Timeline/frame helpers
  const timeline = useMemo(() => (cumulativeMode ? processedTimeline : data?.timeline || []), [data, processedTimeline, cumulativeMode]);
  const frame = timeline[currentFrame];
  const activeCommunities = frame ? Object.keys(frame.communities).length : 0;
  const totalPosts = frame ? Object.values(frame.communities).reduce((s, c) => s + (c.posts || 0), 0) : 0;

  // ——— NEW: Live-selected stats bound to CURRENT frame ———
  const selectedStats = useMemo(() => {
    if (!selectedCommunity || !data || !frame) return null;
    const meta = data.communities[selectedCommunity];
    const live = frame.communities[selectedCommunity] || {};
    const postsNow = live.posts ?? 0;
    const breakdown = getBestPlatformBreakdownFor(selectedCommunity, live, meta);
    const users = meta?.num_users ?? 0;
    return { postsNow, users, breakdown };
  }, [selectedCommunity, data, frame]);

  const currentClusterInfo = useMemo(() => {
    if (!selectedCluster || !availableClusters.length) return null;
    return availableClusters.find(c => c.cluster_id === selectedCluster);
  }, [selectedCluster, availableClusters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-zinc-400 mb-2">Loading narrative data...</p>
          {loadProgress > 0 && (
            <div className="w-64 mx-auto">
              <div className="w-full bg-zinc-800 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${loadProgress}%` }} />
              </div>
              <p className="text-xs text-zinc-500 mt-2">{loadProgress}%</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white">
        <div className="text-center max-w-md p-6 bg-zinc-900/50 backdrop-blur-xl rounded-xl border border-red-900/50">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold mb-2">Error Loading Data</h2>
          <p className="text-zinc-400 mb-4">{error}</p>
          <div className="space-y-2">
            <button onClick={() => window.location.reload()} className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">Retry</button>
            <p className="text-xs text-zinc-600">Make sure your data files are in public/data/ and re-exported with max_communities=50</p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white">
        <div className="text-center">
          <p className="text-zinc-400">No data loaded</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white flex flex-col overflow-hidden box-border p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex-none border-b border-zinc-800/50 bg-zinc-900/30 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* <div className="max-w-[1800px] mx-auto px-6 py-3 flex items-center justify-between gap-4"> */}
          <div className="flex items-center gap-3">
            {/* <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles size={16} />
            </div> */}
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Narrative Diffusion</h1>
              <p className="text-xs text-zinc-500">{formatDate(data.metadata.start_date)} → {formatDate(data.metadata.end_date)}</p>
            </div>
          </div>

          {/* Theme + Narrative pickers */}
          <div className="flex items-center gap-3">
            {uniqueThemes.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="text-sm text-zinc-400">Theme</div>
                <select
                  value={selectedTheme}
                  onChange={e => {
                    setSelectedTheme(e.target.value);
                    const filtered = e.target.value === 'all' ? availableClusters : availableClusters.filter(c => c.theme === e.target.value);
                    if (filtered.length && !filtered.find(c => c.cluster_id === selectedCluster)) setSelectedCluster(filtered[0].cluster_id);
                  }}
                  className="bg-zinc-800/50 backdrop-blur border border-zinc-700/50 rounded-lg px-3 py-2 text-sm hover:border-zinc-600 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                >
                  <option value="all">All Themes</option>
                  {uniqueThemes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="w-px h-6 bg-zinc-700" />
              </div>
            )}
            <div className="text-sm text-zinc-400">Narrative</div>
            <select
              value={selectedCluster || ''}
              onChange={e => {
                setSelectedCluster(Number(e.target.value));
                setIsPlaying(false);
                setSelectedCommunity(null);
              }}
              className="bg-zinc-800/50 backdrop-blur border border-zinc-700/50 rounded-lg px-3 py-2 text-sm min-w-[400px] hover:border-zinc-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              {filteredClusters.map(c => (
                <option key={c.cluster_id} value={c.cluster_id}>{c.overview}</option>
              ))}
            </select>
          </div>

          {/* Quick stats */}
          <div className="flex items-center gap-3 text-sm">
            <Badge glowColor="blue" value={activeCommunities} label="active" />
            <Badge glowColor="green" value={totalPosts.toLocaleString()} label="posts" />
            {currentClusterInfo?.theme && (
              <div className="px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-semibold">{currentClusterInfo.theme}</div>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Viz */}
        <div className="flex-1 flex flex-col p-4 min-w-0 overflow-hidden">
          <div className="flex-1 bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 backdrop-blur-xl rounded-2xl border border-zinc-800/50 shadow-2xl p-4 flex flex-col min-h-0">
            <div className="flex-1 flex items-center justify-center overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-500/5 rounded-xl pointer-events-none" />
              <canvas ref={canvasRef} width={1200} height={650} className="max-w-full max-h-full rounded-xl bg-black shadow-xl relative z-10" />
            </div>

            {/* Controls */}
            <div className="flex-none mt-3 pt-3 border-t border-zinc-800/50 space-y-2.5">
              <div className="flex items-center gap-3">
                <IconButton title="Reset" onClick={() => setCurrentFrame(0)}><SkipBack size={20} /></IconButton>
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`p-3 rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg ${isPlaying ? 'bg-gradient-to-r from-zinc-700 to-zinc-600' : 'bg-gradient-to-r from-blue-600 to-blue-500'} shadow-blue-500/25`}
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <IconButton title="Next" onClick={() => setCurrentFrame(v => Math.min(v + 1, (timeline.length - 1) || 0))}><SkipForward size={20} /></IconButton>

                <div className="flex-1 px-2 relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 rounded-lg blur-sm pointer-events-none" />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, (timeline.length - 1) || 0)}
                    value={currentFrame}
                    onChange={e => setCurrentFrame(parseInt(e.target.value))}
                    className="w-full h-2.5 bg-zinc-800/50 backdrop-blur rounded-lg appearance-none cursor-pointer relative z-10"
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(timeline.length > 1 ? currentFrame / (timeline.length - 1) : 0) * 100}%, rgba(63,63,70,0.5) ${(timeline.length > 1 ? currentFrame / (timeline.length - 1) : 0) * 100}%, rgba(63,63,70,0.5) 100%)`
                    }}
                  />
                </div>

                <div className="px-4 py-2 bg-zinc-800/30 backdrop-blur rounded-lg border border-zinc-700/50">
                  <div className="text-sm text-zinc-400 font-mono flex items-center gap-2">
                    <span>{formatDateForFrame(data.metadata.start_date, (frame?.day_index || 1) - 1)}</span>
                    {cumulativeMode && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />}
                  </div>
                </div>
              </div>

              {/* Speed */}
              <div className="flex items-center gap-3 px-1">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <Radio size={16} className="text-yellow-400" />
                  <span className="text-sm text-yellow-400 font-semibold">Speed</span>
                </div>
                <SpeedButton speed={1000} label="0.5×" title="Slow" state={[animationSpeed, setAnimationSpeed]} gradient="from-blue-600 to-blue-500" />
                <SpeedButton speed={500} label="1×" title="Normal" state={[animationSpeed, setAnimationSpeed]} gradient="from-green-600 to-green-500" />
                <SpeedButton speed={250} label="2×" title="Fast" state={[animationSpeed, setAnimationSpeed]} gradient="from-orange-600 to-orange-500" />
                <SpeedButton speed={100} label="4×" title="Very Fast" state={[animationSpeed, setAnimationSpeed]} gradient="from-red-600 to-red-500" />
                <div className="flex-1" />
                <div className="px-3 py-1.5 bg-zinc-800/30 backdrop-blur rounded-lg border border-zinc-700/50 text-sm text-zinc-400 font-mono">{(1000 / animationSpeed).toFixed(1)} <span className="text-zinc-600">fps</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex-none w-84 p-4 space-y-3 overflow-y-auto">
          {/* View Options */}
          <Card title="View Options" icon={<LayoutGrid size={16} className="text-blue-400" />} iconBg="bg-blue-500/20">
            <ToggleRow
              label="Cumulative Posts"
              sublabel="Posts accumulate over time"
              value={cumulativeMode}
              onChange={setCumulativeMode}
            />
            <ToggleRow
              label="Force-Directed"
              sublabel="Physics-based layout"
              value={useForceLayout}
              onChange={setUseForceLayout}
            />
            <ToggleRow
              label="Show Connections"
              sublabel="Display inter-community ties"
              value={showEdges}
              onChange={setShowEdges}
            />
            <div className="mt-2">
              <label className="text-xs text-zinc-500 mb-1.5 block font-medium">Platform Filter</label>
              <select
                value={filterPlatform}
                onChange={e => setFilterPlatform(e.target.value)}
                className="w-full bg-zinc-800/50 backdrop-blur border border-zinc-700/50 rounded-lg px-3 py-2 text-sm hover:border-zinc-600 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="all">All Platforms</option>
                <option value="twitter">Twitter/X Only</option>
                <option value="tiktok">TikTok Only</option>
                <option value="telegram">Telegram Only</option>
                <option value="truth_social">Truth Social Only</option>
                <option value="mixed">Mixed Only</option>
              </select>
            </div>
          </Card>

          {/* Legend */}
          <Card title="Legend" icon={<HelpCircle size={16} className="text-purple-400" />} iconBg="bg-purple-500/20">
            {/* <div className="space-y-2 text-xs text-zinc-400">
              <LegendRow color="white" label="White ring" value="selected / hovered" />
              <LegendRow color="#22c55e" valueDot label="glow" value="recently active" />
              <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/20">
                <span className="text-zinc-300">Edge brightness</span>
                <span className="text-zinc-500">stronger tie</span>
              </div>
            </div> */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { key: 'twitter', label: 'Twitter/X', icon: Twitter },
                { key: 'tiktok', label: 'TikTok', icon: MessageCircle },
                { key: 'telegram', label: 'Telegram', icon: Send },
                { key: 'truth_social', label: 'Truth Social', icon: Shield }
              ].map(p => {
                const Icon = p.icon;
                const color = getPlatformColor(p.key);
                return (
                  <div key={p.key} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-zinc-800/20 border border-zinc-700/30">
                    <Icon size={14} style={{ color }} />
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}40` }} />
                    <span className="text-zinc-300 font-medium">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Selected community */}
          {selectedCommunity && selectedStats && (
            <Card
              title={`Community ${selectedCommunity}`}
              icon={<Info size={16} className="text-green-400" />}
              iconBg="bg-green-500/20"
              onClose={() => setSelectedCommunity(null)}
            >
              <div>
                <div className="text-xs text-zinc-500 mb-2 font-medium">Platform Mix {cumulativeMode ? '(to date)' : '(this frame)'}</div>
                {(selectedStats.breakdown || []).map(p => {
                  const PlatformIcon = getPlatformIcon(p.platform);
                  return (
                    <div key={p.platform} className="flex items-center justify-between text-xs mb-1.5 p-2 rounded-lg bg-zinc-800/20">
                      <div className="flex items-center gap-2">
                        {PlatformIcon && <PlatformIcon size={12} style={{ color: getPlatformColor(p.platform) }} />}
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getPlatformColor(p.platform), boxShadow: `0 0 8px ${getPlatformColor(p.platform)}60` }} />
                        <span className="capitalize text-zinc-300 font-medium">{p.platform}</span>
                      </div>
                      <span className="text-zinc-500 font-mono font-semibold">{formatPct(p.percentage)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-zinc-800/50 space-y-1.5">
                <div className="flex justify-between text-xs p-2 rounded-lg bg-zinc-800/20">
                  <span className="text-zinc-500">Posts {cumulativeMode ? '(to date)' : '(this frame)'}</span>
                  <span className="font-semibold font-mono text-zinc-300">{(selectedStats.postsNow || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs p-2 rounded-lg bg-zinc-800/20">
                  <span className="text-zinc-500">Users (static)</span>
                  <span className="font-semibold font-mono text-zinc-300">{selectedStats.users}</span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// ——— helpers ———
const IconButton = ({ title, onClick, children }) => (
  <button
    onClick={onClick}
    className="p-2.5 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-xl transition-all hover:scale-105 active:scale-95 border border-zinc-700/50"
    title={title}
  >
    {children}
  </button>
);

const SpeedButton = ({ speed, label, title, state, gradient }) => {
  const [val, setVal] = state;
  const active = val === speed;
  return (
    <button
      onClick={() => setVal(speed)}
      className={`px-4 py-1.5 text-sm rounded-lg transition-all hover:scale-105 active:scale-95 ${
        active ? `bg-gradient-to-r ${gradient} text-white font-semibold shadow-lg` : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200 border border-zinc-700/50'
      }`}
      title={title}
    >
      {label}
    </button>
  );
};

const Badge = ({ glowColor, value, label }) => (
  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-${glowColor}-500/10 border border-${glowColor}-500/20`.replaceAll('#','') }>
    <div className={`w-2 h-2 rounded-full bg-${glowColor}-500 shadow-lg shadow-${glowColor}-500/50`.replaceAll('#','') } />
    <span className={`text-${glowColor}-400 font-semibold`.replaceAll('#','') }>{value}</span>
    <span className="text-zinc-500">{label}</span>
  </div>
);

const Card = ({ title, icon, iconBg, children, onClose }) => (
  <div className="bg-gradient-to-br from-zinc-900/50 to-zinc-800/30 backdrop-blur-xl rounded-2xl border border-zinc-800/50 shadow-xl p-4">
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${iconBg}`}>{icon}</div>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      {onClose && (
        <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors p-1 hover:bg-zinc-800/50 rounded-lg" title="Close">✕</button>
      )}
    </div>
    {children}
  </div>
);

const ToggleRow = ({ label, sublabel, value, onChange }) => (
  <label className="flex items-start gap-3 text-sm cursor-pointer group p-2 rounded-lg hover:bg-zinc-800/30 transition-colors">
    <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="rounded mt-0.5" />
    <div>
      <div className="group-hover:text-white transition-colors font-medium">{label}</div>
      {sublabel && <div className="text-xs text-zinc-500">{sublabel}</div>}
    </div>
  </label>
);

const LegendRow = ({ color, label, value, valueDot = false }) => (
  <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/20">
    <div className="flex items-center gap-2">
      <span className="w-3 h-3 rounded-full" style={{ background: valueDot ? 'transparent' : color, boxShadow: valueDot ? `0 0 10px ${color}` : 'none', border: valueDot ? `2px solid ${color}` : 'none' }} />
      <span className="text-zinc-300">{label}</span>
    </div>
    <span className="text-zinc-500">{value}</span>
  </div>
);

// Choose best breakdown available: frame > counts > meta
function getBestPlatformBreakdownFor(commId, frameComm, metaComm) {
  // 1) if frame contains ready breakdown (array of {platform, percentage})
  if (Array.isArray(frameComm?.platform_breakdown) && frameComm.platform_breakdown.length) {
    return normalizeBreakdown(frameComm.platform_breakdown);
  }
  // 2) if frame contains platform_counts {twitter: n, ...}
  if (frameComm?.platform_counts && Object.keys(frameComm.platform_counts).length) {
    const total = Object.values(frameComm.platform_counts).reduce((s, v) => s + (v || 0), 0) || 1;
    const arr = Object.entries(frameComm.platform_counts).map(([platform, count]) => ({ platform, percentage: (count / total) * 100 }));
    return normalizeBreakdown(arr);
  }
  // 3) fallback to static meta
  if (Array.isArray(metaComm?.platform_breakdown) && metaComm.platform_breakdown.length) {
    return normalizeBreakdown(metaComm.platform_breakdown);
  }
  return [];
}

function normalizeBreakdown(arr) {
  const total = arr.reduce((s, p) => s + (p.percentage || 0), 0) || 1;
  return arr.map(p => ({ platform: p.platform, percentage: (p.percentage || 0) * (100 / total) }));
}

function sumCounts(base = {}, inc = {}) {
  const out = { ...base };
  for (const [k, v] of Object.entries(inc)) out[k] = (out[k] || 0) + (v || 0);
  return out;
}

const getPlatformColor = platform => {
  const colors = {
    twitter: '#87c38f',
    tiktok: '#FF0050',
    telegram: '#0088CC',
    truth_social: '#8B5CF6'
  };
  return colors[platform] || '#999';
};

const getPlatformIcon = platform => ({ twitter: Twitter, tiktok: MessageCircle, telegram: Send, truth_social: Shield }[platform] || null);

const formatDate = dateString => {
  const d = new Date(dateString);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

const formatDateForFrame = (startDateString, dayOffset) => {
  const start = new Date(startDateString);
  const curr = new Date(start);
  curr.setDate(start.getDate() + dayOffset);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[curr.getMonth()]} ${curr.getDate()}, ${curr.getFullYear()}`;
};

const formatPct = v => `${Math.round((v || 0))}%`;

export default NarrativeViz;



