import React, {useCallback, useEffect, useState} from 'react';
import {ArrowLeft, BookOpen, Users} from 'lucide-react';
import {supabase} from './lib';

async function query(request) {
  const {data, error} = await request;
  if (error) throw error;
  return data;
}
function linkValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url;
  try { url = new URL(trimmed); } catch { throw new Error('Indica um link HTTP ou HTTPS válido.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Indica um link HTTP ou HTTPS válido.');
  return url.href;
}
function Message({text, error = false}) {
  return text ? <div className={error ? 'error class-notice' : 'success class-notice'} role={error ? 'alert' : 'status'}>{text}</div> : null;
}

export default function Classrooms({session}) {
  const [classes, setClasses] = useState([]), [selected, setSelected] = useState(null);
  const [teacher, setTeacher] = useState(false), [admin, setAdmin] = useState(false);
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [code, setCode] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    const [list, role, isAdmin] = await Promise.all([
      query(supabase.from('classrooms').select('id,owner_id,title,description,created_at').order('created_at', {ascending:false})),
      query(supabase.from('class_teachers').select('user_id').eq('user_id', session.user.id).maybeSingle()),
      query(supabase.rpc('is_admin'))
    ]);
    setClasses(list || []); setTeacher(!!role); setAdmin(!!isAdmin);
    return list || [];
  }, [session.user.id]);
  useEffect(() => { let active = true; setLoading(true); refresh().catch(() => { if (active) setError('Não foi possível carregar as turmas.'); }).finally(() => { if (active) setLoading(false); }); return () => {active=false}; }, [refresh]);
  async function create(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const id = await query(supabase.rpc('create_classroom', {p_title:title.trim(), p_description:description.trim()}));
      const list = await refresh(); setTitle(''); setDescription(''); setSelected(list.find(item => item.id === id) || null);
      setNotice('Turma criada. Partilha o código apenas com os estudantes da turma.');
    } catch { setError('Não foi possível criar a turma. Confirma a autorização de professor e tenta novamente.'); }
    finally { setBusy(false); }
  }
  async function join(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await query(supabase.rpc('join_classroom', {p_code:code.trim()}));
      if (!result?.ok) { setError(result?.reason === 'rate' ? 'Demasiadas tentativas. Aguarda um minuto.' : 'Código inválido. Confirma o código com o professor.'); return; }
      const list = await refresh(); setCode(''); setSelected(list.find(item => item.id === result.class_id) || null); setNotice('Entraste na turma.');
    } catch { setError('Não foi possível entrar na turma. Tenta novamente.'); }
    finally { setBusy(false); }
  }
  return <>
    <div className="page-title"><div className="section-label">APRENDER EM CONJUNTO <span>—</span></div><h1>Turmas</h1><p>Entra numa turma para consultar e entregar trabalhos.</p></div>
    {notice && <Message text={notice}/>}<Message text={error} error/>
    {selected ? <ClassDetail key={selected.id} classroom={selected} session={session} owner={teacher && selected.owner_id === session.user.id} onBack={() => {setSelected(null); setError(''); setNotice('');}} onDeleted={() => {setClasses(items => items.filter(item => item.id !== selected.id)); setSelected(null); setError(''); setNotice('Turma excluída permanentemente.');}}/> : <>
      {loading ? <div className="panel state-message" role="status">A carregar turmas...</div> : <>
        <div className="classes-forms">
          <div className="panel class-form"><h2>Entrar numa turma</h2><p>Solicita o código de acesso ao professor.</p><form onSubmit={join}><label>Código de acesso<input value={code} onChange={e=>setCode(e.target.value)} maxLength={24} autoComplete="off" required placeholder="Código da turma"/></label><button className="button" disabled={busy}>Entrar na turma</button></form></div>
          {teacher && <div className="panel class-form"><h2>Criar uma turma</h2><p>O código é criado automaticamente e é único.</p><form onSubmit={create}><label>Nome da turma<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required/></label><label>Descrição (opcional)<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={1000} rows={3}/></label><button className="button" disabled={busy}>Criar turma</button></form></div>}
        </div>
        <div className="content-heading"><div><h2>As tuas turmas</h2><p>Turmas criadas ou em que participas.</p></div></div>
        {classes.length ? <div className="subject-grid">{classes.map(item=><button className="panel class-card" key={item.id} onClick={()=>{setNotice('');setError('');setSelected(item)}}><span className="mini-icon blue"><Users size={18}/></span><h3>{item.title}</h3><p>{item.description || 'Turma de estudo'}</p><span className="quick-link">Abrir turma →</span></button>)}</div> : <div className="panel class-empty"><BookOpen size={22}/><p>Ainda não estás em nenhuma turma.</p></div>}
        {admin && <TeacherAdmin/>}
      </>}
    </>}
  </>;
}

function TeacherAdmin() {
  const [items, setItems] = useState([]), [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async()=>setItems(await query(supabase.rpc('list_class_teachers')) || []),[]);
  useEffect(()=>{load().catch(()=>setError('Não foi possível carregar os professores.'));},[load]);
  async function setPermission(value, enabled) {
    setBusy(true); setError(''); setNotice('');
    try { await query(supabase.rpc('set_class_teacher',{p_email:value.trim(),p_enabled:enabled})); await load(); setEmail(''); setNotice(enabled?'Professor autorizado.':'Autorização removida.'); }
    catch { setError('Não foi possível atualizar a autorização. A conta deve estar registada.'); }
    finally { setBusy(false); }
  }
  return <section className="panel teacher-admin"><h2>Autorizações de professor</h2><p>Autoriza contas existentes para criar e gerir turmas. Ao retirar o acesso, o professor deixa de gerir as suas turmas.</p><form className="teacher-form" onSubmit={e=>{e.preventDefault();setPermission(email,true)}}><label>Email da conta<input type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} required/></label><button className="button" disabled={busy}>Autorizar professor</button></form><Message text={error} error/><Message text={notice}/>{items.length ? items.map(item=><div className="teacher-row" key={item.user_id}><span>{item.email}</span><button className="link-button" disabled={busy} onClick={()=>{if(window.confirm('Retirar a autorização deste professor?')) setPermission(item.email,false)}}>Retirar acesso</button></div>) : <p>Ainda não há professores autorizados.</p>}</section>;
}

function ClassDetail({classroom, session, owner, onBack, onDeleted}) {
  const [assignments, setAssignments] = useState([]), [classCode, setClassCode] = useState('');
  const [title, setTitle] = useState(''), [instructions, setInstructions] = useState(''), [resource, setResource] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async()=>{
    const [items, accessCode] = await Promise.all([
      query(supabase.from('class_assignments').select('id,class_id,title,instructions,resource_url,created_at').eq('class_id',classroom.id).order('created_at',{ascending:false})),
      owner ? query(supabase.rpc('classroom_code',{p_class_id:classroom.id})) : Promise.resolve('')
    ]);
    setAssignments(items || []); setClassCode(accessCode || '');
  },[classroom.id,owner]);
  useEffect(()=>{let active=true;load().catch(()=>{if(active)setError('Não foi possível carregar a turma.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[load]);
  async function publish(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const resourceUrl=linkValue(resource);
      await query(supabase.from('class_assignments').insert({class_id:classroom.id,title:title.trim(),instructions:instructions.trim(),resource_url:resourceUrl}));
      setTitle('');setInstructions('');setResource('');await load();setNotice('Trabalho publicado para a turma.');
    } catch(err) {setError(err.message?.startsWith('Indica um link') ? err.message : 'Não foi possível publicar o trabalho.');}
    finally {setBusy(false)}
  }
  async function deleteClassroom() {
    if (!window.confirm('Excluir esta turma permanentemente? As inscrições, trabalhos, entregas e avaliações desta turma serão removidos; as contas dos estudantes não serão apagadas. Esta ação não pode ser desfeita.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await query(supabase.rpc('delete_classroom', {p_class_id:classroom.id})); onDeleted(); }
    catch { setError('Não foi possível excluir a turma. Confirma a tua autorização e tenta novamente.'); }
    finally { setBusy(false); }
  }
  return <div className="class-detail"><button className="link-button class-back" onClick={onBack}><ArrowLeft size={15}/> Voltar às turmas</button><div className="panel class-heading"><h2>{classroom.title}</h2>{classroom.description && <p>{classroom.description}</p>}{owner && <><div className="class-code"><span>Código de acesso da turma</span><strong>{classCode || 'A carregar...'}</strong><small>Partilha este código apenas com os estudantes que queres convidar.</small></div><div className="class-danger"><p>Excluir esta turma remove permanentemente os seus trabalhos, entregas e avaliações.</p><button type="button" className="class-delete" disabled={busy} onClick={deleteClassroom}>Excluir turma</button></div></>}</div>
    <Message text={error} error/><Message text={notice}/>
    {owner && <div className="panel class-form class-publish"><h2>Publicar trabalho</h2><form onSubmit={publish}><label>Título<input maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} required/></label><label>Instruções<textarea maxLength={5000} rows={4} value={instructions} onChange={e=>setInstructions(e.target.value)} required/></label><label>Link de apoio (opcional)<input type="url" maxLength={2048} value={resource} onChange={e=>setResource(e.target.value)} placeholder="https://..."/></label><button className="button" disabled={busy}>Publicar trabalho</button></form></div>}
    <div className="content-heading"><div><h2>Trabalhos</h2><p>As entregas são privadas entre o estudante e o professor.</p></div></div>
    {loading ? <div className="panel" role="status">A carregar trabalhos...</div> : assignments.length ? <div className="class-work-list">{assignments.map(item=><Assignment key={item.id} assignment={item} session={session} owner={owner}/>)}</div> : <div className="panel class-empty"><p>Ainda não há trabalhos publicados.</p></div>}
  </div>;
}

function Assignment({assignment, session, owner}) {
  const [text, setText] = useState(''), [link, setLink] = useState(''), [existing, setExisting] = useState(null);
  const [submissions, setSubmissions] = useState([]), [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    if (owner) {
      const items = await query(supabase.rpc('class_assignment_submissions', {p_assignment_id:assignment.id})) || [];
      const grades = items.length ? await query(supabase.from('class_assessments').select('submission_id,grade,feedback,evaluated_at').in('submission_id', items.map(item => item.id))) : [];
      const byId = new Map((grades || []).map(item => [item.submission_id, item]));
      setSubmissions(items.map(item => ({...item, assessment:byId.get(item.id) || null})));
    } else {
      const data = await query(supabase.from('class_submissions').select('id,content,link_url,submitted_at').eq('assignment_id',assignment.id).eq('user_id',session.user.id).maybeSingle());
      const grade = data ? await query(supabase.from('class_assessments').select('grade,feedback,evaluated_at').eq('submission_id',data.id).maybeSingle()) : null;
      setExisting(data); setText(data?.content || ''); setLink(data?.link_url || ''); setAssessment(grade);
    }
    setLoadFailed(false);
  }, [assignment.id, owner, session.user.id]);
  useEffect(() => {let active=true; load().catch(() => {if(active) {setError('Não foi possível carregar as entregas.'); setLoadFailed(true);}}).finally(() => {if(active) setLoading(false)}); return () => {active=false}}, [load]);
  async function retry() {setLoading(true); setError(''); try {await load()} catch {setLoadFailed(true); setError('Não foi possível carregar as entregas.')} finally {setLoading(false)}}
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const values={content:text.trim(),link_url:linkValue(link)};
      if (existing) {
        const updated=await query(supabase.from('class_submissions').update(values).eq('id',existing.id).eq('user_id',session.user.id).select('id').maybeSingle());
        if (!updated) throw new Error('Entrega não atualizada');
      } else await query(supabase.from('class_submissions').insert({...values,assignment_id:assignment.id,user_id:session.user.id}));
      await load(); setNotice(existing?'Entrega atualizada.':'Trabalho entregue ao professor.');
    } catch(err) {setError(err.message?.startsWith('Indica um link')?err.message:'Não foi possível guardar ou atualizar a entrega. Recarrega para verificar o estado.');}
    finally {setBusy(false)}
  }
  return <article className="panel class-assignment"><h3>{assignment.title}</h3><p className="class-multiline">{assignment.instructions}</p>{assignment.resource_url && <p><a className="class-link" href={assignment.resource_url} target="_blank" rel="noopener noreferrer">Abrir link de apoio ↗</a></p>}
    <Message text={error} error/><Message text={notice}/>
    {loading ? <p role="status">A carregar...</p> : loadFailed ? <button className="link-button" onClick={retry}>Tentar novamente</button> : owner ?
      <div className="class-submissions"><h4>Entregas ({submissions.length})</h4>{submissions.length ? submissions.map(item=><SubmissionReview key={item.id} submission={item} onRefresh={load}/>) : <p>Ainda não há entregas.</p>}</div> :
      <><div className="class-assessment-result"><h4>Avaliação</h4>{assessment ? <><strong>Nota: {assessment.grade} / 20</strong>{assessment.feedback && <p className="class-multiline">{assessment.feedback}</p>}</> : <p>Ainda não avaliado.</p>}</div>
        <form className="class-form class-answer" onSubmit={submit}><label>A tua resposta<textarea rows={4} maxLength={10000} value={text} onChange={e=>setText(e.target.value)} required/></label><label>Link da entrega (opcional)<input type="url" maxLength={2048} value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></label>{existing && <p>Se alterares a resposta ou o link, a avaliação anterior será removida e o professor poderá voltar a avaliar.</p>}<button className="button" disabled={busy}>{existing?'Atualizar entrega':'Entregar trabalho'}</button></form></>}
  </article>;
}

function SubmissionReview({submission, onRefresh}) {
  const [grade, setGrade] = useState(submission.assessment?.grade?.toString() ?? '');
  const [feedback, setFeedback] = useState(submission.assessment?.feedback || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    setGrade(submission.assessment?.grade?.toString() ?? '');
    setFeedback(submission.assessment?.feedback || '');
  }, [submission.content, submission.link_url, submission.assessment?.grade, submission.assessment?.feedback]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await query(supabase.rpc('assess_class_submission', {p_submission_id:submission.id, p_grade:Number(grade), p_feedback:feedback, p_expected_content:submission.content, p_expected_link:submission.link_url}));
      setNotice('Avaliação guardada.');
      try { await onRefresh(); } catch { setNotice('Avaliação guardada. Reabre o trabalho para atualizar os dados.'); }
    } catch(err) {
      if (err.code === '40001') { setError('A entrega foi alterada pelo estudante. Atualiza antes de avaliar.'); }
      else setError('Não foi possível guardar a avaliação. Confirma a tua autorização e tenta novamente.');
    } finally {setBusy(false)}
  }
  async function refresh() {setBusy(true); setError(''); try {await onRefresh(); setNotice('Entrega atualizada. Confere a resposta antes de avaliar.');} catch {setError('Não foi possível atualizar a entrega.');} finally {setBusy(false)}}
  return <div className="class-submission"><strong>{submission.student_name}</strong><p className="class-multiline">{submission.content}</p>{submission.link_url && <a className="class-link" href={submission.link_url} target="_blank" rel="noopener noreferrer">Abrir link entregue ↗</a>}
    <form className="class-review-form class-form" onSubmit={save}><label>Nota (0 a 20)<input type="number" min="0" max="20" step="0.1" value={grade} onChange={e=>setGrade(e.target.value)} required/></label><label>Comentário para o estudante (opcional)<textarea rows={3} maxLength={5000} value={feedback} onChange={e=>setFeedback(e.target.value)}/></label><button className="button" disabled={busy}>{submission.assessment ? 'Atualizar avaliação' : 'Guardar avaliação'}</button></form>
    <Message text={error} error/><Message text={notice}/>{error && <button type="button" className="link-button" disabled={busy} onClick={refresh}>Atualizar entrega</button>}
  </div>;
}
