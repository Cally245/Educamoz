import React, {useCallback, useEffect, useState} from 'react';
import {supabase} from './lib';
async function query(p) {const {data,error}=await p;if(error)throw error;return data;}
const emptyQuestion=()=>({kind:'multiple_choice',question:'',options:['',''],correct:'0'});
export default function TeacherExams({session,onPublished}) {
  const [teacher,setTeacher]=useState(false),[subjects,setSubjects]=useState([]),[reviews,setReviews]=useState([]),[loadError,setLoadError]=useState('');
  const [subject,setSubject]=useState(''),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[questions,setQuestions]=useState([emptyQuestion()]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{
    const role=await query(supabase.from('class_teachers').select('user_id').eq('user_id',session.user.id).maybeSingle());
    setTeacher(Boolean(role)); if(!role)return;
    const [items,answers]=await Promise.all([query(supabase.from('subjects').select('id,title').eq('published',true).order('title')),query(supabase.rpc('teacher_exam_reviews'))]);
    setSubjects(items||[]);setReviews(answers||[]);setLoadError('');
  },[session.user.id]);
  useEffect(()=>{load().catch(()=>setLoadError('Não foi possível carregar a área de professor.'));},[load]);
  function changeQuestion(i,patch){setQuestions(items=>items.map((item,index)=>index===i?{...item,...patch}:item));}
  async function publish(event){event.preventDefault();setBusy(true);setError('');setNotice('');try{
    const payload=questions.map(q=>q.kind==='written'?{kind:q.kind,question:q.question.trim()}:{kind:q.kind,question:q.question.trim(),options:q.options.map(o=>o.trim()),correct:Number(q.correct)});
    if(payload.some(q=>!q.question || (q.kind==='multiple_choice'&&(q.options.some(o=>!o)||q.correct>=q.options.length)))) throw new Error('Preenche todas as perguntas e opções e escolhe a resposta correta.');
    await query(supabase.rpc('teacher_create_exam',{p_subject_id:subject,p_title:title.trim(),p_description:description.trim(),p_questions:payload}));
    setTitle('');setDescription('');setSubject('');setQuestions([emptyQuestion()]);setNotice('Exame publicado no simulador para todos os estudantes.');onPublished();
  }catch(err){setError(err.message?.startsWith('Preenche')?err.message:'Não foi possível publicar o exame. Confirma os dados e a autorização.')}finally{setBusy(false)}}
  if(!teacher)return loadError?<p role="alert" className="error">{loadError}</p>:null;
  return <section className="teacher-exams"><div className="content-heading"><div><h2>Gestão de exames</h2><p>Exames publicados ficam disponíveis a todos os estudantes. As respostas escritas são avaliadas pelo autor do exame.</p></div></div>
    <div className="panel class-form"><h2>Criar exame</h2><form onSubmit={publish}>
      <label>Disciplina publicada<select value={subject} onChange={e=>setSubject(e.target.value)} required><option value="">Escolhe uma disciplina</option>{subjects.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Título<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} required/></label><label>Descrição<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={5000} rows={3}/></label>
      {questions.map((q,i)=><fieldset className="exam-editor-question" key={i}><legend>Pergunta {i+1}</legend><label>Tipo<select value={q.kind} onChange={e=>changeQuestion(i,{kind:e.target.value})}><option value="multiple_choice">Escolha múltipla</option><option value="written">Resposta escrita</option></select></label><label>Pergunta<textarea value={q.question} onChange={e=>changeQuestion(i,{question:e.target.value})} maxLength={2000} rows={2} required/></label>
        {q.kind==='multiple_choice'&&<><label>Opções (uma por linha, entre 2 e 6)<textarea value={q.options.join('\n')} onChange={e=>changeQuestion(i,{options:e.target.value.split('\n')})} rows={4} required/></label><label>Número da opção correta (a primeira é 1)<input type="number" min="1" max={q.options.length} value={Number(q.correct)+1} onChange={e=>changeQuestion(i,{correct:String(Number(e.target.value)-1)})} required/></label></>}
        {questions.length>1&&<button className="link-button" type="button" onClick={()=>setQuestions(items=>items.filter((_,index)=>index!==i))}>Remover pergunta</button>}</fieldset>)}
      <button type="button" className="link-button" disabled={questions.length>=30} onClick={()=>setQuestions(items=>[...items,emptyQuestion()])}>+ Adicionar pergunta</button><button className="button" disabled={busy}>{busy?'A publicar...':'Publicar exame'}</button>
    </form>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="success" role="status">{notice}</p>}</div>
    <div className="panel class-form teacher-reviews"><h2>Respostas escritas dos teus exames</h2><p>O resultado final só fica disponível após avaliar todas as respostas escritas da tentativa.</p>{loadError&&<p className="error" role="alert">{loadError}</p>}{reviews.length?reviews.map(item=><Review key={item.answer_id} review={item} onSaved={load}/>):<p>Ainda não há respostas para avaliar.</p>}</div>
  </section>;
}
function Review({review,onSaved}) {
  const [grade,setGrade]=useState(review.grade?.toString()??''),[feedback,setFeedback]=useState(review.feedback||''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function save(e){e.preventDefault();setBusy(true);setError('');setMessage('');try{await query(supabase.rpc('teacher_grade_exam_answer',{p_answer_id:review.answer_id,p_grade:Number(grade),p_feedback:feedback}));setMessage('Avaliação guardada.');try {await onSaved();} catch {setMessage('Avaliação guardada. Recarrega a página para atualizar a lista.');}}catch{setError('Não foi possível guardar a avaliação.')}finally{setBusy(false)}}
  return <div className="class-submission"><strong>{review.exam_title} — {review.student_name}</strong><p>{review.question}</p><p className="class-multiline">{review.answer}</p><form className="class-review-form" onSubmit={save}><label>Nota desta resposta (0 a 20)<input type="number" min="0" max="20" step="0.1" value={grade} onChange={e=>setGrade(e.target.value)} required/></label><label>Comentário (opcional)<textarea value={feedback} onChange={e=>setFeedback(e.target.value)} maxLength={5000} rows={2}/></label><button className="button" disabled={busy}>Guardar avaliação</button></form>{error&&<p className="error" role="alert">{error}</p>}{message&&<p className="success" role="status">{message}</p>}</div>;
}
