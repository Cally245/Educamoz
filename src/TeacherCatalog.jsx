import React, {useCallback, useEffect, useState} from 'react';
import {supabase} from './lib';

async function request(promise) {
  const {data, error} = await promise;
  if (error) throw error;
  return data;
}

export default function TeacherCatalog({session, onPublished}) {
  const [teacher, setTeacher] = useState(null);
  const [subjects, setSubjects] = useState([]), [ownSubjects, setOwnSubjects] = useState([]), [ownTopics, setOwnTopics] = useState([]), [topics, setTopics] = useState([]);
  const [kind, setKind] = useState('subject'), [title, setTitle] = useState(''), [slug, setSlug] = useState(''), [description, setDescription] = useState(''), [subjectId, setSubjectId] = useState('');
  const [url, setUrl] = useState(''), [topicId, setTopicId] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const role = await request(supabase.from('class_teachers').select('user_id').eq('user_id',session.user.id).maybeSingle());
    setTeacher(Boolean(role));
    if (!role) return;
    const [available, mine, myTopics, publishedTopics] = await Promise.all([
      request(supabase.from('subjects').select('id,title').eq('published',true).order('title')),
      request(supabase.from('subjects').select('id,title,published').eq('created_by',session.user.id).order('title')),
      request(supabase.from('topics').select('id,title,subject_id,published').eq('created_by',session.user.id).order('title')),
      request(supabase.from('topics').select('id,title,subject_id').eq('published',true).order('title'))
    ]);
    setSubjects(available || []); setOwnSubjects(mine || []); setOwnTopics(myTopics || []); setTopics(publishedTopics || []);
  }, [session.user.id]);
  useEffect(() => { let active = true; load().catch(() => {if (active) setError('Não foi possível verificar o acesso ao catálogo.')}).finally(() => {if (active) setLoading(false)}); return () => {active=false}; }, [load]);
  async function create(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (kind === 'subject') {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())) throw new Error('Usa um identificador com letras minúsculas, números e hífen.');
        await request(supabase.rpc('teacher_create_subject', {p_title:title.trim(),p_slug:slug.trim(),p_description:description.trim()}));
      } else if (kind === 'material') {
        const parsed = new URL(url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Indica um link HTTP ou HTTPS válido.');
        await request(supabase.rpc('teacher_create_material',{p_title:title.trim(),p_description:description.trim(),p_url:parsed.href,p_topic_id:topicId || null}));
      } else {
        await request(supabase.rpc('teacher_create_topic', {p_subject_id:subjectId,p_title:title.trim(),p_description:description.trim()}));
      }
      setTitle(''); setSlug(''); setDescription(''); setSubjectId(''); setUrl(''); setTopicId('');
      setNotice(kind === 'subject' ? 'Disciplina publicada para os estudantes.' : kind === 'material' ? 'Material publicado na Biblioteca.' : 'Matéria publicada para os estudantes.');
      onPublished();
      try {await load();} catch {setError('O conteúdo foi publicado, mas não foi possível atualizar a lista. Recarrega a página.');}
    } catch (err) {
      setError(err.code === '23505' ? 'Este identificador já existe. Escolhe outro.' : (err.message?.startsWith('Usa um identificador') || err.message?.startsWith('Indica um link')) ? err.message : 'Não foi possível publicar. Confirma a autorização e os dados e tenta novamente.');
    } finally {setBusy(false);}
  }
  if (loading) return null;
  if (!teacher) return error ? <div className="error teacher-catalog-error" role="alert">{error}</div> : null;
  return <section className="teacher-catalog" aria-labelledby="teacher-catalog-title">
    <div className="content-heading"><div><h2 id="teacher-catalog-title">Publicar conteúdos</h2><p>Professores autorizados publicam diretamente no catálogo de toda a plataforma.</p></div></div>
    <div className="admin-tabs" aria-label="Tipo de conteúdo"><button type="button" className={kind==='subject'?'selected':''} onClick={()=>{setKind('subject');setError('');setNotice('')}}>Disciplina</button><button type="button" className={kind==='topic'?'selected':''} onClick={()=>{setKind('topic');setError('');setNotice('')}}>Matéria</button><button type="button" className={kind==='material'?'selected':''} onClick={()=>{setKind('material');setError('');setNotice('')}}>Material de estudo</button></div>
    <div className="admin-columns"><div className="panel form-panel teacher-catalog-form"><h3>{kind==='subject'?'Nova disciplina':kind==='material'?'Novo material de estudo':'Nova matéria'}</h3><p>O conteúdo fica visível aos estudantes assim que for publicado.</p>
      <form onSubmit={create}>
        <label>Título<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={kind==='subject'?120:kind==='material'?200:160} required/></label>
        {kind==='subject' ? <label>Identificador (ex.: matematica)<input value={slug} onChange={e=>setSlug(e.target.value)} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} required/></label> : kind==='material' ? <><label>Link do material<input type="url" value={url} onChange={e=>setUrl(e.target.value)} maxLength={2048} placeholder="https://..." required/></label><label>Matéria (opcional)<select value={topicId} onChange={e=>setTopicId(e.target.value)}><option value="">Sem matéria associada</option>{topics.filter(t=>subjects.some(s=>s.id===t.subject_id)).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label></> : <label>Disciplina publicada<select value={subjectId} onChange={e=>setSubjectId(e.target.value)} required><option value="">Escolhe uma disciplina</option>{subjects.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        <label>Descrição<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={4} maxLength={5000}/></label>
        <button className="button" disabled={busy}>{busy?'A publicar...':'Publicar para todos'}</button>
      </form>{error && <div className="error" role="alert">{error}</div>}{notice && <p className="success" role="status">{notice}</p>}
    </div><div className="panel history-panel teacher-catalog-list"><h3>Conteúdos que publicaste</h3><p>Para alterar ou retirar conteúdo, contacta o administrador.</p>
      <h4>Disciplinas</h4>{ownSubjects.length ? ownSubjects.map(item=><div className="activity-item" key={item.id}><div><b>{item.title}</b><small>{item.published?'Publicada':'Não publicada'}</small></div></div>) : <p>Ainda não publicaste disciplinas.</p>}
      <h4>Matérias</h4>{ownTopics.length ? ownTopics.map(item=><div className="activity-item" key={item.id}><div><b>{item.title}</b><small>{item.published && subjects.some(subject=>subject.id===item.subject_id)?'Publicada':'Não visível no catálogo'}</small></div></div>) : <p>Ainda não publicaste matérias.</p>}
    </div></div>
  </section>;
}
